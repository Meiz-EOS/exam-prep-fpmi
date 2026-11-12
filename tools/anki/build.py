#!/usr/bin/env python3
"""Build an Anki package from the JSON emitted by tools/pack/dump-pack.ts."""
import argparse
import html
import hashlib
import json
import re
from pathlib import Path

import genanki

MODEL_ID = 1700000000001
MODEL = genanki.Model(
    MODEL_ID,
    "Зачётка: вопрос-ответ",
    fields=[{"name": "Вопрос"}, {"name": "Ответ"}, {"name": "Источник"}],
    templates=[{
        "name": "Карточка",
        "qfmt": "{{Вопрос}}",
        "afmt": "{{FrontSide}}<hr id=answer>{{Ответ}}<br><small>{{Источник}}</small>",
    }],
)


def stable_id(value: str) -> int:
    return int.from_bytes(hashlib.sha256(value.encode("utf-8")).digest()[:4], "big") & 0x7FFFFFFF or 1


def guid(pack_id: str, card_id: str) -> str:
    digest = hashlib.sha256(f"{pack_id}:{card_id}".encode("utf-8")).hexdigest()
    return genanki.guid_for(digest)


def mathjax(text: str) -> str:
    """Card markdown → Anki field HTML: everything escaped; code fences, inline code and $…$ formulas kept."""
    def tex(body: str, display: bool) -> str:
        body = html.escape(body, quote=False)
        return (r"\[" + body + r"\]") if display else (r"\(" + body + r"\)")

    def inline(chunk: str) -> str:
        out, pos = [], 0
        for match in re.finditer(r"`([^`\n]+)`|\$\$(.+?)\$\$|\$(.+?)\$", chunk, flags=re.S):
            out.append(html.escape(chunk[pos:match.start()], quote=False).replace("\n", "<br>"))
            if match.group(1) is not None:
                out.append("<code>" + html.escape(match.group(1), quote=False) + "</code>")
            elif match.group(2) is not None:
                out.append(tex(match.group(2), True))
            else:
                out.append(tex(match.group(3), False))
            pos = match.end()
        out.append(html.escape(chunk[pos:], quote=False).replace("\n", "<br>"))
        return "".join(out)

    parts = re.split(r"```[a-zA-Z+]*\n(.*?)```", text, flags=re.S)
    return "".join(inline(part) if i % 2 == 0 else "<pre><code>" + html.escape(part.rstrip("\n"), quote=False) + "</code></pre>"
                   for i, part in enumerate(parts))


def content_hash(card: dict) -> str:
    content = {key: card[key] for key in ("id", "deck", "subject", "tickets", "question", "answer", "source")}
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def build(pack: dict, output: Path, only_changed: bool = False) -> list[str]:
    root = Path(__file__).resolve().parents[2]
    card_list = pack.get("cards", [])
    state_path = root / "packs" / pack["id"] / "private" / "anki-built.json"
    previous = json.loads(state_path.read_text(encoding="utf-8")) if only_changed and state_path.exists() else {}
    hashes = {card["id"]: content_hash(card) for card in card_list}
    selected = [card for card in card_list if not only_changed or previous.get(card["id"]) != hashes[card["id"]]]
    subjects = {subject["id"]: subject["name"] for subject in pack["subjects"]}
    grouped: dict[str, genanki.Deck] = {}
    for card in selected:
        deck_name = f"zachetka::{subjects[card['subject']]}::{card['deck']}"
        deck = grouped.setdefault(deck_name, genanki.Deck(stable_id(deck_name), deck_name))
        deck.add_note(genanki.Note(
            model=MODEL,
            fields=[mathjax(card["question"]), mathjax(card["answer"]), card["source"]],
            guid=guid(pack["id"], card["id"]),
            tags=list(card["tickets"]) + ["L0"],
        ))
    output.parent.mkdir(parents=True, exist_ok=True)
    genanki.Package(list(grouped.values())).write_to_file(str(output))
    if only_changed:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(hashes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return [guid(pack["id"], card["id"]) for card in selected]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pack_json", type=Path, help="built pack JSON")
    parser.add_argument("--only-changed", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    pack = json.loads(args.pack_json.read_text(encoding="utf-8"))
    output = args.output or Path("dist/anki") / f"{pack['id']}.apkg"
    build(pack, output, args.only_changed)
    print(output)


if __name__ == "__main__":
    main()
