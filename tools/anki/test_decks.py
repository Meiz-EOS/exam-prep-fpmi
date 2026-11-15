"""Decks and new-card order by the topic graph (Р-87), checked in the built .apkg and after an import."""
import json
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

from anki.collection import Collection

from build import build, guid, placement
from test_build import import_package

ROOT = Path(__file__).resolve().parents[2]


def card(card_id, subject, tickets, deck="Старая колода"):
    return {"id": card_id, "deck": deck, "subject": subject, "tickets": tickets,
            "question": f"Вопрос {card_id}", "answer": "Ответ", "source": "src"}


# Subjects, topics and cards are deliberately not in alphabetical order: the order must come from the pack.
PACK = {
    "id": "deck-test",
    "subjects": [
        {"id": "aig", "name": "Я-геометрия"},
        {"id": "ma", "name": "Анализ"},
        {"id": "old", "name": "Без графа"},
    ],
    "graph": [
        {"id": "aig-g-lin", "subject": "aig", "title": "Линейная алгебра", "tickets": ["aig-t-3", "aig-t-1"], "requires": []},
        {"id": "aig-g-geo", "subject": "aig", "title": "Аналитическая геометрия", "tickets": ["aig-t-2"], "requires": ["aig-g-lin"]},
        {"id": "ma-g-lim", "subject": "ma", "title": "Пределы", "tickets": ["ma-t-1"], "requires": []},
    ],
    "cards": [
        card("old-c-1", "old", ["old-t-1"], deck="Б-тема"),
        card("ma-c-1", "ma", ["ma-t-1"]),
        card("aig-c-geo", "aig", ["aig-t-2", "aig-t-3"]),
        card("aig-c-free", "aig", []),
        card("aig-c-lin-b", "aig", ["aig-t-1"]),
        card("aig-c-lin-a2", "aig", ["aig-t-3"]),
        card("aig-c-lin-a1", "aig", ["aig-t-3", "aig-t-2"]),
        card("old-c-2", "old", ["old-t-2"], deck="А-тема"),
    ],
}

EXPECTED = [
    ("aig-c-free", "zachetka::Я-геометрия::00 Вне тем"),
    ("aig-c-lin-a2", "zachetka::Я-геометрия::01 Линейная алгебра"),
    ("aig-c-lin-a1", "zachetka::Я-геометрия::01 Линейная алгебра"),
    ("aig-c-lin-b", "zachetka::Я-геометрия::01 Линейная алгебра"),
    ("aig-c-geo", "zachetka::Я-геометрия::02 Аналитическая геометрия"),
    ("ma-c-1", "zachetka::Анализ::01 Пределы"),
    ("old-c-1", "zachetka::Без графа::Б-тема"),
    ("old-c-2", "zachetka::Без графа::А-тема"),
]


def apkg_rows(path, folder):
    """(card id of the pack, deck name, due, type, queue) of every card in the package, ordered by due."""
    with zipfile.ZipFile(path) as archive:
        archive.extract("collection.anki2", folder)
    conn = sqlite3.connect(str(Path(folder) / "collection.anki2"))
    try:
        decks = {int(key): value["name"] for key, value in json.loads(conn.execute("select decks from col").fetchone()[0]).items()}
        by_guid = {guid(PACK["id"], item["id"]): item["id"] for item in PACK["cards"]}
        return [(by_guid[note_guid], decks[did], due, ctype, queue) for note_guid, did, due, ctype, queue in conn.execute(
            "select n.guid,c.did,c.due,c.type,c.queue from cards c join notes n on n.id=c.nid order by c.due")]
    finally:
        conn.close()


class DeckTest(unittest.TestCase):
    def test_placement_names_and_order(self):
        placed = placement(PACK)
        self.assertEqual([(card_id, placed[card_id]) for card_id, _ in EXPECTED],
                         [(card_id, (deck, due)) for due, (card_id, deck) in enumerate(EXPECTED)])

    def test_three_digit_numbers_for_100_topics(self):
        pack = {"id": "wide", "subjects": [{"id": "s", "name": "S"}],
                "graph": [{"id": f"g{n}", "subject": "s", "title": f"T{n}", "tickets": [f"t{n}"], "requires": []} for n in range(100)],
                "cards": [card("c", "s", ["t9"])]}
        self.assertEqual(placement(pack)["c"][0], "zachetka::S::010 T9")

    def test_remapped_ticket_and_ticket_outside_topics(self):
        pack = json.loads(json.dumps(PACK))
        pack["remap"] = {"aig-t-old": "aig-t-2"}
        pack["cards"] = [card("a", "aig", ["aig-t-old"]), card("b", "aig", ["aig-t-nowhere"])]
        placed = placement(pack)
        self.assertEqual(placed["a"][0], "zachetka::Я-геометрия::02 Аналитическая геометрия")
        self.assertEqual(placed["b"], ("zachetka::Я-геометрия::00 Вне тем", 0))

    def test_apkg_decks_and_due(self):
        with tempfile.TemporaryDirectory(prefix="anki-deck-test-") as temp:
            package = Path(temp) / "pack.apkg"
            build(PACK, package)
            rows = apkg_rows(package, temp)
        self.assertEqual([(card_id, deck) for card_id, deck, *_ in rows], EXPECTED)
        self.assertEqual([due for _, _, due, _, _ in rows], list(range(len(EXPECTED))))
        self.assertTrue(all(ctype == 0 and queue == 0 for *_, ctype, queue in rows), "all cards are new")

    def test_import_keeps_order_and_subdecks_sort_by_number(self):
        with tempfile.TemporaryDirectory(prefix="anki-deck-test-") as temp:
            temp = Path(temp)
            build(PACK, temp / "pack.apkg")
            col = Collection(str(temp / "collection.anki2"))
            try:
                import_package(col, temp / "pack.apkg")
                by_guid = {guid(PACK["id"], item["id"]): item["id"] for item in PACK["cards"]}
                rows = col.db.all("select n.guid,c.did,c.due from cards c join notes n on n.id=c.nid where c.type=0 order by c.due")
                self.assertEqual([(by_guid[row[0]], col.decks.name(row[1])) for row in rows], EXPECTED)
                self.assertEqual(len({row[2] for row in rows}), len(rows), "positions are distinct")
                # Anki's deck list is sorted by name: topics of one subject go in the order of their numbers.
                names = [item.name for item in col.decks.all_names_and_ids() if item.name.startswith("zachetka::Я-геометрия::")]
                self.assertEqual(names, sorted(names))
                self.assertEqual([name.split("::")[-1] for name in names],
                                 ["00 Вне тем", "01 Линейная алгебра", "02 Аналитическая геометрия"])
                # What Anki really shows first in a topic deck and in the whole subject (default deck options).
                for deck, first in (("zachetka::Я-геометрия::01 Линейная алгебра", "aig-c-lin-a2"),
                                    ("zachetka::Я-геометрия", "aig-c-free")):
                    col.decks.select(col.decks.id_for_name(deck))
                    queued = col.sched.get_queued_cards(fetch_limit=1).cards[0]
                    self.assertEqual(by_guid[col.get_note(queued.card.note_id).guid], first)
                # The whole `zachetka` deck: by default Anki gathers new cards deck by deck (subjects by alphabet);
                # the pack order needs the deck option «New card gather order: Ascending position».
                config = col.decks.get_config(1)
                config["newGatherPriority"] = 1  # NEW_CARD_GATHER_PRIORITY_LOWEST_POSITION
                col.decks.update_config(config)
                col.decks.select(col.decks.id_for_name("zachetka"))
                queue = [by_guid[col.get_note(item.card.note_id).guid] for item in col.sched.get_queued_cards(fetch_limit=20).cards]
                self.assertEqual(queue, [card_id for card_id, _ in EXPECTED])
            finally:
                col.close()

    @unittest.skipUnless(shutil.which("node"), "node is needed to call topicDeck()")
    def test_deck_name_equals_topic_deck_of_the_engine(self):
        script = ("import { buildGraph, topicDeck } from './engine/src/core/graph.ts';"
                  "const pack = JSON.parse(process.argv[1]); const graph = buildGraph(pack.graph);"
                  "console.log(JSON.stringify(Object.fromEntries(pack.graph.map((t) => [t.id, topicDeck(pack, graph, t.id)]))));")
        done = subprocess.run(["node", "--input-type=module", "-e", script, json.dumps(PACK)],
                              cwd=ROOT, capture_output=True, text=True, check=True)
        decks = json.loads(done.stdout)
        placed = placement(PACK)
        self.assertEqual(placed["aig-c-lin-b"][0], decks["aig-g-lin"])
        self.assertEqual(placed["aig-c-geo"][0], decks["aig-g-geo"])
        self.assertEqual(placed["ma-c-1"][0], decks["ma-g-lim"])


if __name__ == "__main__":
    unittest.main()
