"""Integration tests for collection reports, isolated in a system temp directory."""
import json
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from anki.collection import Collection

from build import build
from report import collect, report, report_json, snapshot
from test_build import import_package


PACK = {
    "id": "report-test", "subjects": [{"id": "math", "name": "Математика"}],
    "cards": [
        {"id": "c1", "deck": "Пределы", "subject": "math", "tickets": ["math-t-0001"], "question": "Q1", "answer": "A1", "source": "s1"},
        {"id": "c2", "deck": "Пределы", "subject": "math", "tickets": ["math-t-0002"], "question": "Q2", "answer": "A2", "source": "s2"},
    ],
}


class ReportTest(unittest.TestCase):
    def test_json_output_contains_collected_report_data(self):
        data = {"due": [{"cid": 12}], "lapses_by_tag": {"math-t-0001": 2}}
        self.assertEqual(json.loads(report_json(data)), data)

    def test_report_sections(self):
        with tempfile.TemporaryDirectory(prefix="anki-report-test-") as root:
            root = Path(root)
            package = root / "pack.apkg"
            build(PACK, package)
            col = Collection(str(root / "collection.anki2"))
            try:
                import_package(col, package)
                notes = sorted((col.get_note(nid) for nid in col.find_notes("")), key=lambda n: n.fields[0])
                cards = [col.get_card(n.card_ids()[0]) for n in notes]
            finally:
                col.close()
            raw = sqlite3.connect(root / "collection.anki2")
            raw.execute("update cards set due=0,queue=2 where id in (?,?)", (cards[0].id, cards[1].id))
            raw.execute("update cards set flags=1,lapses=4 where id=?", (cards[0].id,))
            # due is a day number from collection creation: 1000 days ahead is not due (it would be if counted from 1970)
            raw.execute("update cards set due=1000,queue=2 where id=?", (cards[1].id,))
            raw.execute("update notes set flds=? where id=?", ("Q1 edited\x1fA1\x1fs1", notes[0].id))
            raw.execute("update notes set guid='removed-guid' where id=?", (notes[1].id,))
            raw.execute("insert into revlog(id,cid,usn,ease,ivl,lastIvl,factor,time,type) values(?,?,?,?,?,?,?,?,?)",
                        (int(time.time() * 1000), cards[0].id, 0, 1, 0, 0, 2500, 1000, 0))
            raw.commit()
            raw.close()
            pack_path = root / "pack.json"
            pack_path.write_text(json.dumps(PACK, ensure_ascii=False), encoding="utf-8")
            cli = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("report.py")), str(root / "collection.anki2"), str(pack_path), "--json"],
                check=True, capture_output=True, text=True,
            )
            cli_data = json.loads(cli.stdout)
            self.assertEqual(len(cli_data["due"]), 1)
            self.assertIn("lapses_by_tag", cli_data)
            temp, conn = snapshot(root / "collection.anki2")
            try:
                data = collect(conn, PACK)
                text = report(data)
                self.assertEqual(len(data["due"]), 1)
                self.assertIn("math-t-0001", data["lapses_by_tag"])
                self.assertEqual(data["flags"][0]["flags"], 1)
                self.assertTrue(data["edits"])
                self.assertEqual(data["removed"][0]["guid"], "removed-guid")
                for section in ("сегодня", "Снова", "Самые забываемые", "ошибка", "Правки текста", "кандидаты на suspend"):
                    self.assertIn(section, text)
                self.assertLessEqual(len(text.splitlines()), 30)
            finally:
                conn.close()
                temp.cleanup()


if __name__ == "__main__":
    unittest.main()
