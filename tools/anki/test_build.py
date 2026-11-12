"""Integration check for deterministic package IDs and history-safe imports."""
import json
import tempfile
import time
import unittest
from pathlib import Path

from anki.collection import Collection, ImportAnkiPackageOptions, ImportAnkiPackageRequest
from anki.scheduler.v3 import CardAnswer

from build import build, guid

PACK = {
    "id": "anki-test",
    "subjects": [{"id": "math", "name": "Математика"}],
    "cards": [{"id": "math-c-1", "deck": "Пределы", "subject": "math", "tickets": ["math-t-1"],
               "question": "Вопрос $x<y$", "answer": "Ответ", "source": "math.tex:1-2"}],
}


def import_package(collection, path):
    values = ImportAnkiPackageOptions.DESCRIPTOR.fields_by_name["update_notes"].enum_type.values_by_name
    condition = values["IMPORT_ANKI_PACKAGE_UPDATE_CONDITION_IF_NEWER"].number
    options = ImportAnkiPackageOptions(update_notes=condition, update_notetypes=condition, merge_notetypes=True)
    return collection.import_anki_package(ImportAnkiPackageRequest(package_path=str(path), options=options))


class BuildTest(unittest.TestCase):
    def test_fields_escape_html_and_keep_code_and_math(self):
        from build import mathjax
        self.assertEqual(mathjax("`std::pair<T, U>` и $a<b$"), "<code>std::pair&lt;T, U&gt;</code> и \\(a&lt;b\\)")
        self.assertIn("<pre><code>int x = a &lt; b;</code></pre>", mathjax("```cpp\nint x = a < b;\n```"))
        self.assertEqual(mathjax("строка\nещё"), "строка<br>ещё")

    def test_stable_guid_and_reimport_preserves_revlog(self):
        with tempfile.TemporaryDirectory(prefix="anki-test-") as temp:
            temp = Path(temp)
            p1, p2, p3 = temp / "one.apkg", temp / "two.apkg", temp / "edit.apkg"
            first_guids = build(PACK, p1)
            self.assertEqual(first_guids, build(PACK, p2))
            time.sleep(1.1)
            edited = json.loads(json.dumps(PACK))
            edited["cards"][0]["answer"] = "Исправленный ответ"
            self.assertEqual(first_guids, build(edited, p3))
            self.assertEqual(first_guids[0], guid("anki-test", "math-c-1"))
            col = Collection(str(temp / "collection.anki2"))
            try:
                import_package(col, p1)
                note = col.get_note(col.find_notes("")[0])
                card = col.get_card(note.card_ids()[0])
                card.start_timer()
                states = col._backend.get_scheduling_states(card.id)
                col.sched.answer_card(col.sched.build_answer(card=card, states=states, rating=CardAnswer.GOOD))
                before = col.db.all("select id,cid,ease,ivl,lastIvl,type from revlog order by id")
                import_package(col, p3)
                after = col.db.all("select id,cid,ease,ivl,lastIvl,type from revlog order by id")
                self.assertEqual(before, after)
                self.assertEqual(col.get_note(note.id).fields[1], "Исправленный ответ")
            finally:
                col.close()


if __name__ == "__main__":
    unittest.main()
