// Pure part of the course-source sync (docs/architecture/12-sync.md): parsing sources and the update rule.
// No I/O here; tools/sync/sync.ts fetches the inputs and writes the result.
import type { Status } from "../../engine/src/core/status.ts";

/** One status claim from a source about one pack item. */
export interface Observation {
  item: string;
  status: Status;
  /** Short human label of where it came from, for the report. */
  source: string;
}

/** A source value that names no pack item (shown in the report). */
export interface Unmapped {
  source: string;
  key: string;
}

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const MANYTASK: Record<string, Status> = { "+": "принято", "?": "сдано", "-": "доработка" };

/** Manytask review_details sheet: rows of the login; status + / ? / - . */
export function fromManytask(csv: string, login: string, tasks: Record<string, string>): { obs: Observation[]; unmapped: Unmapped[] } {
  const rows = parseCsv(csv);
  const head = rows[0]?.map((h) => h.trim()) ?? [];
  const col = (name: string) => head.indexOf(name);
  const [cl, ct, cs] = [col("login"), col("task"), col("status")];
  if (cl < 0 || ct < 0 || cs < 0) throw new Error("manytask sheet: columns login/task/status not found");
  const obs: Observation[] = [];
  const unmapped: Unmapped[] = [];
  for (const r of rows.slice(1)) {
    if (r[cl]?.trim() !== login) continue;
    const task = r[ct]!.trim();
    const status = MANYTASK[r[cs]!.trim()];
    if (!status) continue;
    const item = tasks[task];
    if (item) obs.push({ item, status, source: `manytask ${task} ${r[cs]!.trim()}` });
    else unmapped.push({ source: "manytask", key: task });
  }
  return { obs, unmapped };
}

/**
 * `git ls-remote` output: an MR whose head equals a submit/<task> branch means the task is handed in.
 * Accepted/rework states are not visible here; the manytask sheet gives them.
 */
export function fromGitlabRefs(lsRemote: string, tasks: Record<string, string>): { obs: Observation[]; unmapped: Unmapped[] } {
  const branchBySha = new Map<string, string>();
  const mrHeads: string[] = [];
  for (const line of lsRemote.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref) continue;
    const b = /^refs\/heads\/submit\/(.+)$/.exec(ref);
    if (b) branchBySha.set(sha, b[1]!);
    if (/^refs\/merge-requests\/\d+\/head$/.test(ref)) mrHeads.push(sha);
  }
  const obs: Observation[] = [];
  const unmapped: Unmapped[] = [];
  for (const sha of mrHeads) {
    const task = branchBySha.get(sha);
    if (!task) continue;
    const item = tasks[task];
    if (item) obs.push({ item, status: "сдано", source: `MR submit/${task}` });
    else unmapped.push({ source: "gitlab MR", key: task });
  }
  return { obs, unmapped };
}

export interface GithubPr {
  number: number;
  headRefName: string;
  state: string;            // OPEN | CLOSED | MERGED
  reviewDecision: string;   // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | ""
}

/** Code review PRs: branch "<N>contest_task<X>" → aisd-c<N>-<x>. */
export function fromGithubPrs(prs: readonly GithubPr[], items: ReadonlySet<string>): { obs: Observation[]; unmapped: Unmapped[] } {
  const obs: Observation[] = [];
  const unmapped: Unmapped[] = [];
  for (const pr of prs) {
    const m = /^(\d+)contest_task([A-Za-z])$/.exec(pr.headRefName);
    if (!m) continue;
    let status: Status | undefined;
    if (pr.state === "MERGED" || pr.reviewDecision === "APPROVED") status = "принято";
    else if (pr.state === "OPEN") status = pr.reviewDecision === "CHANGES_REQUESTED" ? "доработка" : "сдано";
    if (!status) continue;
    const item = `aisd-c${m[1]}-${m[2]!.toLowerCase()}`;
    if (items.has(item)) obs.push({ item, status, source: `PR #${pr.number} ${pr.headRefName}` });
    else unmapped.push({ source: "github PR", key: `#${pr.number} ${pr.headRefName}` });
  }
  return { obs, unmapped };
}

/** Solution files: algos_dz_<N>/<x>.cpp → aisd-c<N>-<x> is "сдано" (decision 12.11). */
export function fromCotests(files: readonly string[], items: ReadonlySet<string>): { obs: Observation[]; unmapped: Unmapped[] } {
  const obs: Observation[] = [];
  const unmapped: Unmapped[] = [];
  for (const f of files) {
    const m = /^algos_dz_(\d+)\/([A-Za-z])\.cpp$/.exec(f);
    if (!m) continue;
    const item = `aisd-c${m[1]}-${m[2]!.toLowerCase()}`;
    if (items.has(item)) obs.push({ item, status: "сдано", source: `cotests ${f}` });
    else unmapped.push({ source: "cotests", key: f });
  }
  return { obs, unmapped };
}

/**
 * Main-stream algorithms sheet: a "Теория" block follows each "<N>. … Контест" block; any grade in the student's
 * row for theory N means theory homework N was checked → aisd-td<NN> "принято" (decision 12.11).
 */
export function fromAlgoTheory(csv: string, student: string, items: ReadonlySet<string>): { obs: Observation[]; unmapped: Unmapped[] } {
  const rows = parseCsv(csv);
  const head = rows[0] ?? [];
  const me = rows.find((r) => (r[1] ?? "").trim() === student);
  if (!me) throw new Error(`algorithms sheet: student "${student}" not found`);
  const starts = head.map((c, i) => [i, c.trim()] as const).filter(([, c]) => c);
  const obs: Observation[] = [];
  const unmapped: Unmapped[] = [];
  let contest: string | undefined;
  starts.forEach(([i, title], k) => {
    const n = /^(\d+)\.\s.*Контест$/.exec(title);
    if (n) { contest = n[1]; return; }
    if (title !== "Теория" || !contest) return;
    const end = starts[k + 1]?.[0] ?? head.length;
    const graded = me.slice(i, end).some((v) => v.trim() !== "" && Number.isFinite(Number(v.replace(",", "."))));
    if (!graded) return;
    const item = `aisd-td${contest.padStart(2, "0")}`;
    if (items.has(item)) obs.push({ item, status: "принято", source: `таблица потока: теория ${contest}` });
    else unmapped.push({ source: "algo sheet theory", key: contest });
  });
  return { obs, unmapped };
}

const RANK: Record<Status, number> = { "не начато": 0, "в работе": 1, "доработка": 2, "сдано": 3, "принято": 4 };

/** Several sources about one item: the strongest claim wins ("доработка" only if nothing says more). */
export function combine(obs: readonly Observation[]): Map<string, Observation> {
  const best = new Map<string, Observation>();
  for (const o of obs) {
    const cur = best.get(o.item);
    if (!cur || RANK[o.status] > RANK[cur.status]) best.set(o.item, o);
  }
  return best;
}

export interface Change {
  item: string;
  from: Status;
  to: Status;
  source: string;
}

/**
 * Applies source claims to current statuses (decision 12.11): a claim acts only when the source value changed
 * since the last sync (`seen`), so a later manual mark is not overwritten by a stale table; it may raise the
 * status or set "доработка", never lower it otherwise.
 */
export function decide(
  claims: ReadonlyMap<string, Observation>,
  current: ReadonlyMap<string, Status>,
  seen: Readonly<Record<string, string>>,
): { changes: Change[]; seen: Record<string, string> } {
  const changes: Change[] = [];
  const next: Record<string, string> = { ...seen };
  for (const [item, o] of claims) {
    next[item] = o.status;
    if (seen[item] === o.status) continue;
    const from = current.get(item) ?? "не начато";
    if (from === o.status) continue;
    if (o.status === "доработка" || RANK[o.status] > RANK[from]) changes.push({ item, from, to: o.status, source: o.source });
  }
  return { changes, seen: next };
}
