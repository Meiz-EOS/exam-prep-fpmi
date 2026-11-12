"""SP-5 вопрос 3: FSRS — где включается, переносит ли его .apkg (genanki и экспорт самого Anki)."""
import os, shutil, sys, zipfile, json, sqlite3
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from q1_import import imp
from anki.collection import Collection, ExportAnkiPackageOptions

d = os.path.join(SCRATCH, "q3"); shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
# 1) что в genanki-пакете
p1 = os.path.join(d, "gen.apkg"); build(V1, p1)
z = zipfile.ZipFile(p1); print("содержимое genanki .apkg:", z.namelist())
z.extractall(os.path.join(d, "gen")); c = sqlite3.connect(os.path.join(d, "gen", "collection.anki2"))
dc = json.loads(c.execute("select dconf from col").fetchone()[0]); print("genanki dconf ключи:", {k: sorted(v) for k, v in dc.items()}["1"][:40])
print("genanki dconf fsrs-ключи:", [k for k in dc["1"] if "fsrs" in k.lower()])

# 2) где FSRS в коллекции
col = Collection(os.path.join(d, "a.anki2"))
cfg = col.decks.all_config()[0]
print("ключи пресета (fsrs/desired):", {k: v for k, v in cfg.items() if "fsrs" in k.lower() or "retention" in k.lower() or "desired" in k.lower() or k in ("id", "name")})
print("глобальный флаг fsrs до:", col.get_config("fsrs"))
col.set_config("fsrs", True); print("после:", col.get_config("fsrs"))
cfg = col.decks.add_config_returning_id("Зачётка FSRS"); cfg = col.decks.get_config(cfg)
cfg["desiredRetention"] = 0.85; cfg["fsrsParams6"] = [0.2172, 1.1771, 3.2602, 16.1507, 7.0114, 0.57, 2.0966, 0.0069, 1.5261, 0.112, 1.0178, 1.849, 0.1133, 0.3127, 2.2934, 0.2191, 3.0004, 0.7536, 0.3332, 0.1437, 0.2]
col.decks.update_config(cfg)
print("пресеты в коллекции:", [(x["id"], x["name"], x["desiredRetention"], len(x["fsrsParams6"])) for x in col.decks.all_config()])
imp(col, p1)
# пресет «Зачётка FSRS» назначаем колоде и экспортируем
did = col.decks.id_for_name(DECK_NAME)
deck = col.decks.get(did); deck["conf"] = cfg["id"]; col.decks.save(deck); print("колода -> пресет", col.decks.config_dict_for_deck_id(did)["name"])
out = os.path.join(d, "anki-export.apkg")
n = col.export_anki_package(out_path=out, options=ExportAnkiPackageOptions(with_scheduling=True, with_deck_configs=True, with_media=False, legacy=False), limit=did)
print("экспорт Anki: заметок", n, os.path.getsize(out), "байт; содержимое:", zipfile.ZipFile(out).namelist())
col.close()

# 3) импорт экспорта Anki в свежую коллекцию: переносится ли пресет/FSRS
for with_dc in (True, False):
    c2 = Collection(os.path.join(d, f"b{with_dc}.anki2"))
    print(f"импорт экспорта Anki (with_deck_configs={with_dc}):", imp(c2, out, with_deck_configs=with_dc))
    print("   пресеты:", [(x["name"], x.get("desiredRetention"), len(x["fsrsParams6"])) for x in c2.decks.all_config()],
          "| пресет колоды:", c2.decks.config_dict_for_deck_id(c2.decks.id_for_name(DECK_NAME))["name"],
          "| глобальный fsrs:", c2.get_config("fsrs"))
    c2.close()
# и импорт genanki в свежую
c3 = Collection(os.path.join(d, "c.anki2")); imp(c3, p1)
print("импорт genanki: пресет колоды:", c3.decks.config_dict_for_deck_id(c3.decks.id_for_name(DECK_NAME))["name"], "| fsrs:", c3.get_config("fsrs"))
c3.close()
