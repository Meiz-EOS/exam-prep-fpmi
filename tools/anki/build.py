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


OFF_TOPIC = "00 Вне тем"


def placement(pack: dict) -> dict[str, tuple[str, int]]:
    """Card id → (full deck name, new-card position `due`), Р-87.

    Subject with a graph: deck `zachetka::<subject>::<NN> <topic>` by the card's first ticket — the same string as
    `topicDeck()` in engine/src/core/graph.ts; a card outside every topic goes to `…::00 Вне тем`.
    Subject without a graph: `zachetka::<subject>::<deck>`, as before.
    `due` grows in the order: subjects of the pack → topics (`pack["graph"]` is already in the canonical order and is
    not re-sorted here) → place of the card's first ticket in the topic → order in `pack["cards"]`.
    Positions are counted over all cards of the pack, so a partial build (--only-changed) gives the same numbers.
    """
    names = {subject["id"]: subject["name"] for subject in pack["subjects"]}
    subject_place = {subject["id"]: place for place, subject in enumerate(pack["subjects"])}
    graph = pack.get("graph") or []
    remap = pack.get("remap") or {}
    topics: dict[str, list[dict]] = {}
    for topic in graph:
        topics.setdefault(topic["subject"], []).append(topic)
    # ticket → (number of its topic inside the subject, place of the ticket inside the topic, topic label)
    ticket_place: dict[str, tuple[int, int, str]] = {}
    for subject_topics in topics.values():
        width = max(2, len(str(len(subject_topics))))
        for number, topic in enumerate(subject_topics, start=1):
            label = f"{number:0{width}d} {topic['title']}"
            for place, ticket in enumerate(topic["tickets"]):
                ticket_place[ticket] = (number, place, label)
    keyed = []
    for index, card in enumerate(pack.get("cards", [])):
        subject = card["subject"]
        if subject in topics:
            first = card["tickets"][0] if card["tickets"] else None
            number, place, label = ticket_place.get(remap.get(first, first), (0, 0, OFF_TOPIC))
        else:
            number, place, label = 0, 0, card["deck"]
        keyed.append(((subject_place[subject], number, place, index), card["id"], f"zachetka::{names[subject]}::{label}"))
    keyed.sort(key=lambda item: item[0])
    return {card_id: (deck, due) for due, (_, card_id, deck) in enumerate(keyed)}


def content_hash(card: dict, deck: str) -> str:
    content = {key: card[key] for key in ("id", "subject", "tickets", "question", "answer", "source")}
    content["deck"] = deck
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def build(pack: dict, output: Path, only_changed: bool = False) -> list[str]:
    root = Path(__file__).resolve().parents[2]
    card_list = pack.get("cards", [])
    state_path = root / "packs" / pack["id"] / "private" / "anki-built.json"
    previous = json.loads(state_path.read_text(encoding="utf-8")) if only_changed and state_path.exists() else {}
    placed = placement(pack)
    hashes = {card["id"]: content_hash(card, placed[card["id"]][0]) for card in card_list}
    selected = [card for card in card_list if not only_changed or previous.get(card["id"]) != hashes[card["id"]]]
    selected.sort(key=lambda card: placed[card["id"]][1])
    grouped: dict[str, genanki.Deck] = {}
    for card in selected:
        deck_name, due = placed[card["id"]]
        deck = grouped.setdefault(deck_name, genanki.Deck(stable_id(deck_name), deck_name))
        deck.add_note(genanki.Note(
            model=MODEL,
            fields=[mathjax(card["question"]), mathjax(card["answer"]), card["source"]],
            guid=guid(pack["id"], card["id"]),
            tags=list(card["tickets"]) + ["L0"],
            due=due,  # genanki's default is 0 for every card, which leaves the order of new cards to Anki
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
