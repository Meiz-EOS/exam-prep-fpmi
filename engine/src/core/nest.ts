/** Separator between a group and its part, as written in pack group names: "АиГ задание 2 · неделя 1". */
const PART_SEP = " · ";

export interface GroupNode { name: string; label: string; children: GroupNode[] }

/**
 * Nest groups by name: "X · part" goes under "X" when a group "X" exists (one level).
 * Order of first appearance is kept; a part whose parent is absent stays on top.
 */
export function nestGroups(names: readonly string[]): GroupNode[] {
  const all = new Set(names);
  const top: GroupNode[] = [];
  const byName = new Map<string, GroupNode>();
  for (const name of names) {
    const cut = name.lastIndexOf(PART_SEP);
    const parent = cut > 0 ? name.slice(0, cut) : null;
    if (parent && all.has(parent) && !parent.includes(PART_SEP)) {
      let p = byName.get(parent);
      if (!p) { p = { name: parent, label: parent, children: [] }; byName.set(parent, p); top.push(p); }
      p.children.push({ name, label: name.slice(cut + PART_SEP.length), children: [] });
    } else if (!byName.has(name)) {
      const node = { name, label: name, children: [] };
      byName.set(name, node);
      top.push(node);
    }
  }
  return top;
}
