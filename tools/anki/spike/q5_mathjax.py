"""SP-5 вопрос 4 (MathJax): что видит рендер карточки (без GUI MathJax не исполняется — проверяем, что \\(…\\) доходит до вьювера нетронутым)."""
import os, shutil, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from q1_import import imp
from anki.collection import Collection
d = os.path.join(SCRATCH, "q5"); shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
p = os.path.join(d, "v1.apkg"); build(V1, p)
col = Collection(os.path.join(d, "c.anki2")); imp(col, p)
for cid in col.find_cards(""):
    r = col.get_card(cid).render_output()
    print("Q:", r.question_text[:90]); print("A:", r.answer_text[-160:].replace("\n", " "))
col.close()
