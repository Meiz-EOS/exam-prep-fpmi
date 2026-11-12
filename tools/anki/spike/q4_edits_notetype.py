"""SP-5: (a) правка заметки в Anki vs реимпорт, (b) дубли типов заметок/колод при повторном импорте,
(c) смена полей/шаблона типа заметки с тем же id. Каждый случай — в свежей коллекции."""
import os, shutil, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from q1_import import imp, UPD
import genanki
from anki.collection import Collection

d = os.path.join(SCRATCH, "q4"); shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
p1 = os.path.join(d, "v1.apkg"); build(V1, p1)
_n = [0]


def fresh():
    _n[0] += 1
    c = Collection(os.path.join(d, f"c{_n[0]}.anki2")); imp(c, p1); return c


nt = lambda col: [(m["name"], m["id"]) for m in col.models.all() if "Зачётка" in m["name"]]
col = fresh()
print("(b) повторный импорт того же v1:", imp(col, p1), "| типы:", nt(col), "| заметок:", col.note_count(),
      "| колоды:", sorted(x["name"] for x in col.decks.all() if x["name"].startswith("zachetka")))
col.close()

# (a) порядок: импорт v1 -> (2 с) правка в Anki -> (2 с) сборка apkg «позже правки»; и наоборот
for order in ("apkg позже правки в Anki", "apkg раньше правки в Anki"):
    for mode in ("IF_NEWER", "ALWAYS", "NEVER"):
        col = fresh(); nid = col.find_notes("")[0]
        time.sleep(2.1)
        if order.startswith("apkg позже"):
            n = col.get_note(nid); n["Ответ"] = "ПРАВКА ИЗ ANKI"; col.update_note(n); time.sleep(2.1)
            p = os.path.join(d, "late.apkg"); build(V1, p)
        else:
            p = os.path.join(d, "early.apkg"); build(V1, p); time.sleep(2.1)
            n = col.get_note(nid); n["Ответ"] = "ПРАВКА ИЗ ANKI"; col.update_note(n)
        r = imp(col, p, update_notes=UPD[mode])
        print(f"(a) {order}, update_notes={mode}: {r} -> Ответ = {col.get_note(nid)['Ответ'][:25]!r}")
        col.close()

# (c) тот же model id, добавлено поле «Подсказка», изменён шаблон
M2 = genanki.Model(MODEL_ID, "Зачётка: вопрос-ответ", fields=[{"name": "Вопрос"}, {"name": "Ответ"}, {"name": "Источник"}, {"name": "Подсказка"}],
                   templates=[{"name": "Карточка", "qfmt": "{{Вопрос}}", "afmt": "{{FrontSide}}<hr id=answer>{{Ответ}} v2"}])
M3 = genanki.Model(MODEL_ID, "Зачётка: вопрос-ответ", fields=[{"name": "Вопрос"}, {"name": "Ответ"}, {"name": "Источник"}],
                   templates=[{"name": "Карточка", "qfmt": "{{Вопрос}}", "afmt": "{{FrontSide}}<hr id=answer>{{Ответ}} v2"}])
for label, M, extra in (("+поле", M2, ["h"]), ("только шаблон", M3, [])):
    deck = genanki.Deck(DECK_ID, DECK_NAME)
    for cid, (q, a, s) in V1.items():
        deck.add_note(genanki.Note(model=M, fields=[q, a, s] + extra, guid=guid(cid)))
    time.sleep(1.1); p3 = os.path.join(d, "v3.apkg"); genanki.Package(deck).write_to_file(p3)
    for mrg in (False, True):
        for un in ("IF_NEWER", "NEVER"):
            col = fresh(); time.sleep(1.1)
            r = imp(col, p3, merge_notetypes=mrg, update_notetypes=UPD[un])
            ms = [m for m in col.models.all() if "Зачётка" in m["name"]]
            print(f"(c) {label}, merge={mrg}, update_notetypes={un}: {r}; типов={len(ms)}",
                  [(m["name"], len(m["flds"]), "v2" in m["tmpls"][0]["afmt"]) for m in ms])
            col.close()
