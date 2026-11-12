"""SP-5 вопрос 2: чтение revlog/cards/notes/flags из КОПИИ collection.anki2 (+ -wal), коллекция открыта и закрыта."""
import os, shutil, sqlite3, sys, glob
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from q1_import import imp, answer
from anki.collection import Collection
from anki.scheduler.v3 import CardAnswer

d = os.path.join(SCRATCH, "q2"); shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
src = os.path.join(d, "live"); os.makedirs(src)
p1 = os.path.join(d, "v1.apkg"); build(V1, p1)
col = Collection(os.path.join(src, "collection.anki2")); imp(col, p1)
cid = col.find_cards("")[0]
answer(col, cid, CardAnswer.GOOD); answer(col, cid, CardAnswer.AGAIN)
col.set_user_flag_for_cards(3, [cid])   # зелёный
print("journal_mode (открыта):", col.db.scalar("pragma journal_mode"))
print("файлы при открытой коллекции:", {os.path.basename(f): os.path.getsize(f) for f in glob.glob(src + "/collection.anki2*")})

SQL_REVLOG = """select datetime(id/1000,'unixepoch') as ts, cid, ease, ivl, lastIvl, factor, time as ms, type from revlog order by id"""
SQL_CARDS = """select c.id, n.guid, c.did, c.type, c.queue, c.due, c.ivl, c.reps, c.lapses, c.flags, c.data
               from cards c join notes n on n.id=c.nid order by c.id"""
SQL_NOTES = """select n.guid, n.tags, substr(n.flds,1,40), n.mod from notes n"""


def read(path, label):
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)  # без immutable: чтобы подхватился -wal
    try:
        r = c.execute(SQL_REVLOG).fetchall(); cc = c.execute(SQL_CARDS).fetchall()
        print(f"[{label}] revlog={len(r)} flags={[x[9] for x in cc]} ivl={[x[6] for x in cc]}")
        return r
    except Exception as e:
        print(f"[{label}] ОШИБКА {type(e).__name__}: {e}")
    finally:
        c.close()


for variant, files in (("только collection.anki2", ["collection.anki2"]),
                       ("collection.anki2 + -wal", ["collection.anki2", "collection.anki2-wal"])):
    t = os.path.join(d, "copy-open-" + variant.split()[0][:4] + str(len(files))); os.makedirs(t)
    for f in files:
        if os.path.exists(os.path.join(src, f)): shutil.copy(os.path.join(src, f), t)
    print("копия:", variant, os.listdir(t)); read(os.path.join(t, "collection.anki2"), "открыта, " + variant)

# чтение ОРИГИНАЛА read-only при открытой коллекции (WAL: читатели не блокируют писателя)
read(os.path.join(src, "collection.anki2"), "оригинал ro, открыта")
# безопасная копия через backup API sqlite (согласованный снимок db+wal)
bk = os.path.join(d, "backup.anki2")
a = sqlite3.connect(f"file:{os.path.join(src, 'collection.anki2')}?mode=ro", uri=True); b = sqlite3.connect(bk); a.backup(b); a.close(); b.close()
read(bk, "backup API, открыта")
col.close()
print("файлы после закрытия:", {os.path.basename(f): os.path.getsize(f) for f in glob.glob(src + "/collection.anki2*")})
t = os.path.join(d, "copy-closed"); os.makedirs(t); shutil.copy(os.path.join(src, "collection.anki2"), t)
c = sqlite3.connect(os.path.join(t, "collection.anki2"))
print("journal_mode (закрыта):", c.execute("pragma journal_mode").fetchone())
print("revlog:"); [print("  ", r) for r in c.execute(SQL_REVLOG)]
print("cards:"); [print("  ", r) for r in c.execute(SQL_CARDS)]
print("notes:"); [print("  ", r) for r in c.execute(SQL_NOTES)]
print("поля заметки (flds разделены \\x1f):", c.execute("select flds from notes limit 1").fetchone()[0].split("\x1f"))
print("deck names:", c.execute("select name from decks").fetchall())
