#!/usr/bin/env python3
"""Read study history and edits from an Anki collection snapshot."""
import argparse
import difflib
import json
import sqlite3
import tempfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from build import guid, mathjax

SEP = "\x1f"
TAGS = {1: "ошибка", 2: "лишняя"}


def deck_names(conn):
    return {int(row[0]): row[1].replace(SEP, "::") for row in conn.execute("select id,name from decks")}


def expected_cards(pack):
    subjects = {subject["id"]: subject["name"] for subject in pack.get("subjects", [])}
    result = {}
    for card in pack.get("cards", []):
        result[guid(pack["id"], card["id"])] = {
            "id": card["id"], "question": mathjax(card["question"]),
            "answer": mathjax(card["answer"]), "source": card["source"],
            "deck": f"zachetka::{subjects[card['subject']]}::{card['deck']}",
        }
    return result


def read_cards(conn, now):
    """Cards of zachetka decks with their note data and whether they are due by `now`."""
    decks = deck_names(conn)
    # Review due dates are day numbers counted from the collection's creation (col.crt, set at Anki's day rollover).
    crt = conn.execute("select crt from col").fetchone()[0]
    today = int((now.timestamp() - crt) // 86400)
    cards = []
    for row in conn.execute("""select c.id,c.nid,c.did,c.due,c.flags,c.lapses,c.queue,n.guid,n.tags,n.flds
                              from cards c join notes n on n.id=c.nid"""):
        cid, nid, did, due, flags, lapses, queue, note_guid, tags, fields = row
        deck = decks.get(did, "")
        if not deck.startswith("zachetka::"):
            continue
        values = fields.split(SEP)
        while len(values) < 3:
            values.append("")
        due_today = (queue in (2, 3) and due <= today) or (queue == 1 and due <= int(now.timestamp()))
        cards.append({"cid": cid, "nid": nid, "deck": deck, "due": due, "queue": queue, "flags": flags,
                      "lapses": lapses, "guid": note_guid, "tags": tags.strip().split(),
                      "fields": values, "due_today": due_today})
    return cards


def lapses_by_tag(conn, cards, now):
    """"Again" answers of the last 7 days, counted per ticket tag."""
    since_ms = int((now - timedelta(days=7)).timestamp() * 1000)
    counts = Counter()
    by_cid = {c["cid"]: c for c in cards}
    for (cid,) in conn.execute("select cid from revlog where id>=? and ease=1", (since_ms,)):
        card = by_cid.get(cid)
        if card:
            ticket_tags = [tag for tag in card["tags"] if "-t-" in tag]
            for tag in ticket_tags or ["(без тега)"]:
                counts[tag] += 1
    return counts


def card_edits(cards, expected):
    """Cards whose text differs from the pack (with a short diff) and cards the pack no longer has."""
    edits, removed = [], []
    for card in cards:
        wanted = expected.get(card["guid"])
        if wanted is None:
            removed.append(card)
        elif card["fields"][:3] != [wanted["question"], wanted["answer"], wanted["source"]]:
            diff = list(difflib.unified_diff(
                (wanted["question"] + "\n" + wanted["answer"]).splitlines(),
                (card["fields"][0] + "\n" + card["fields"][1]).splitlines(),
                fromfile="пакет", tofile="Anki", lineterm="", n=1))
            edits.append({"cid": card["cid"], "guid": card["guid"], "diff": diff[2:6]})
    return edits, removed


def collect(conn, pack, now=None):
    now = now or datetime.now(timezone.utc)
    expected = expected_cards(pack)
    cards = read_cards(conn, now)
    edits, removed = card_edits(cards, expected)
    return {"due": [c for c in cards if c["due_today"]],
            "lapses_by_tag": lapses_by_tag(conn, cards, now),
            "forgotten": sorted(cards, key=lambda c: (-c["lapses"], c["cid"]))[:5],
            "flags": [c for c in cards if c["flags"] in TAGS],
            "edits": edits, "removed": removed}


def report(data):
    lines = [f"К повторению сегодня: {len(data['due'])}"]
    lines.append("Снова за 7 дней по тегам: " + (", ".join(f"{tag}={n}" for tag, n in sorted(data["lapses_by_tag"].items())[:6]) or "нет"))
    lines.append("Самые забываемые (lapses):")
    lines.extend(f"  {c['cid']}: {c['lapses']}" for c in data["forgotten"])
    lines.append("Флаги: " + (", ".join(f"{TAGS[c['flags']]} #{c['cid']}" for c in data["flags"]) or "нет"))
    lines.append("Правки текста (перенос согласовать):")
    for item in data["edits"][:5]:
        lines.append(f"  #{item['cid']} " + (" | ".join(item["diff"])[:100] or "текст отличается"))
    lines.append("Убраны из пакета — кандидаты на suspend:")
    lines.extend(f"  #{c['cid']} {c['guid']}" for c in data["removed"][:8])
    if len(data["removed"]) > 8:
        lines.append(f"  … ещё {len(data['removed']) - 8}")
    return "\n".join(lines[:30])


def report_json(data):
    return json.dumps(data, ensure_ascii=False)


def snapshot(path):
    source = sqlite3.connect(f"file:{Path(path).resolve()}?mode=ro", uri=True)
    temp = tempfile.TemporaryDirectory(prefix="anki-report-")
    target = sqlite3.connect(str(Path(temp.name) / "collection.anki2"))
    source.backup(target)
    source.close()
    return temp, target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("collection", type=Path)
    parser.add_argument("pack_json", type=Path, help="JSON emitted by tools/pack/dump-pack.ts")
    parser.add_argument("--suspend-removed", action="store_true")
    parser.add_argument("--json", action="store_true", help="print collected report data as JSON")
    args = parser.parse_args()
    pack = json.loads(args.pack_json.read_text(encoding="utf-8"))
    temp, conn = snapshot(args.collection)
    try:
        data = collect(conn, pack)
        print(report_json(data) if args.json else report(data))
        if args.suspend_removed:
            conn.executemany("update cards set queue=-1 where id=?", [(c["cid"],) for c in data["removed"]])
            conn.commit()
            backup = sqlite3.connect(str(args.collection))
            conn.backup(backup)
            backup.close()
    finally:
        conn.close()
        temp.cleanup()


if __name__ == "__main__":
    main()
