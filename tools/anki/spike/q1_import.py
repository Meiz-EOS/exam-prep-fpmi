"""SP-5 вопросы 1, 2, 4: импорт, повторные ответы, реимпорт. Всё во временной коллекции."""
import os, shutil, sqlite3, time, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from anki.collection import Collection, ImportAnkiPackageRequest, ImportAnkiPackageOptions as O
from anki.scheduler.v3 import CardAnswer

U = O.DESCRIPTOR.fields_by_name["update_notes"].enum_type.values_by_name
UPD = {k.replace("IMPORT_ANKI_PACKAGE_UPDATE_CONDITION_", ""): v.number for k, v in U.items()}


def imp(col, path, **kw):
    opts = dict(merge_notetypes=False, update_notes=UPD["IF_NEWER"], update_notetypes=UPD["IF_NEWER"],
                with_scheduling=True, with_deck_configs=True)
    opts.update(kw)
    r = col.import_anki_package(ImportAnkiPackageRequest(package_path=path, options=O(**opts)))
    log = r.log
    return dict(new=len(log.new), updated=len(log.updated), duplicate=len(log.duplicate),
                conflicting=len(log.conflicting), first_field_match=len(log.first_field_match))


def dump(col, title):
    print(f"--- {title}")
    print("notetypes:", [(m["name"], m["id"]) for m in col.models.all()])
    print("decks:", [(d["name"], d["id"]) for d in col.decks.all()])
    for nid in sorted(col.find_notes("")):
        n = col.get_note(nid)
        print("note", n.guid, n.fields[0][:50], "| cards:", [(c.id, c.type, c.queue, c.due, c.ivl, c.reps, c.lapses, c.flags)
              for c in n.cards()])
    print("revlog:", col.db.all("select id,cid,ease,ivl,lastIvl,type from revlog order by id"))


def answer(col, cid, rating):
    card = col.get_card(cid)
    card.start_timer()
    states = col._backend.get_scheduling_states(card.id)
    col.sched.answer_card(col.sched.build_answer(card=card, states=states, rating=rating))


if __name__ == "__main__":
    fsrs = "--fsrs" in sys.argv
    d = os.path.join(SCRATCH, "q1" + ("-fsrs" if fsrs else ""))
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    p1, p2 = os.path.join(d, "v1.apkg"), os.path.join(d, "v2.apkg")
    build(V1, p1); time.sleep(1.1); build(V2, p2)
    col = Collection(os.path.join(d, "collection.anki2"))
    if fsrs:
        col.set_config("fsrs", True)
    print("fsrs config:", col.get_config("fsrs"))
    print("import v1:", imp(col, p1))
    dump(col, "после v1")
    ids = {col.get_note(n)["Вопрос"][:12]: n for n in col.find_notes("")}
    cards = {col.get_note(n).guid: col.get_note(n).card_ids()[0] for n in col.find_notes("")}
    g = {c: guid(c) for c in V1}
    # 0001: Good, Good; 0002: Again, Good; 0003: Good + флаг 2 (оранжевый)
    answer(col, cards[g["matan-c-0001"]], CardAnswer.GOOD); answer(col, cards[g["matan-c-0001"]], CardAnswer.GOOD)
    answer(col, cards[g["matan-c-0002"]], CardAnswer.AGAIN); answer(col, cards[g["matan-c-0002"]], CardAnswer.GOOD)
    answer(col, cards[g["matan-c-0003"]], CardAnswer.GOOD)
    col.set_user_flag_for_cards(2, [cards[g["matan-c-0003"]]])
    dump(col, "после ответов")
    before = col.db.all("select id,cid,ease,ivl,type from revlog order by id")
    state_before = {c: tuple(col.db.first("select due,ivl,reps,lapses,flags,type,queue from cards where id=?", cid))
                    for c, cid in cards.items()}
    mode = next((a.split("=")[1] for a in sys.argv if a.startswith("--mode=")), "IF_NEWER")
    kw = {}
    if mode.startswith("SCHED0"): kw = dict(with_scheduling=False)
    elif mode != "IF_NEWER": kw = dict(update_notes=UPD[mode])
    if "--merge" in sys.argv: kw["merge_notetypes"] = True
    print(f"import v2 ({mode}, {kw}):", imp(col, p2, **kw))
    dump(col, "после v2")
    after = col.db.all("select id,cid,ease,ivl,type from revlog order by id")
    print("revlog сохранён:", before == after[:len(before)] and len(before) == len(after), len(before), len(after))
    for c in g:
        cid = cards.get(g[c])
        if cid:
            row = col.db.first("select due,ivl,reps,lapses,flags,type,queue from cards where id=?", cid)
            print(c, "до", state_before[g[c]], "после", tuple(row) if row else "КАРТОЧКА УДАЛЕНА")
    print("notes total:", col.note_count(), "cards total:", col.card_count())
    col.close()
