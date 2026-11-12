"""SP-5: общие вещи спайка (временные скрипты, W2-02)."""
import hashlib, os, tempfile, time
import genanki

SCRATCH = os.environ.get("SP5_DIR", os.path.join(tempfile.gettempdir(), "sp5"))
PACK = "matan-spike"
MODEL_ID = 1700000000001   # стабильный id типа заметки
DECK_ID = 1700000000002    # стабильный id колоды
DECK_NAME = "zachetka::матан::Пределы"


def guid(card_id: str) -> str:
    """GUID = стабильный хеш('pack:cardid'): 10 байт sha256 -> base64-подобная строка."""
    h = hashlib.sha256(f"{PACK}:{card_id}".encode()).digest()
    return genanki.guid_for(h.hex())  # genanki.guid_for даёт base91 от хеша


MODEL = genanki.Model(
    MODEL_ID, "Зачётка: вопрос-ответ",
    fields=[{"name": "Вопрос"}, {"name": "Ответ"}, {"name": "Источник"}],
    templates=[{
        "name": "Карточка",
        "qfmt": "{{Вопрос}}",
        "afmt": "{{FrontSide}}<hr id=answer>{{Ответ}}<br><small>{{Источник}}</small>",
    }],
)

V1 = {
    "matan-c-0001": ("Определение предела последовательности (ε–N).",
                     r"\(\lim x_n = a \iff \forall \varepsilon>0\ \exists N\ \forall n>N:\ |x_n-a|<\varepsilon\)",
                     "matan.tex:452-470"),
    "matan-c-0002": ("Сформулируйте теорему Вейерштрасса о монотонной последовательности.",
                     "Монотонная ограниченная последовательность сходится.", "matan.tex:612-640"),
    "matan-c-0003": ("Чему равен предел \\(\\frac{\\sin x}{x}\\) при \\(x\\to0\\)?", "\\(1\\)", "matan.tex:700-710"),
}
# v2: 0001 — правка текста, 0002 — удалена, 0004 — добавлена
V2 = {
    "matan-c-0001": (V1["matan-c-0001"][0] + " [ПРАВКА]", V1["matan-c-0001"][1], V1["matan-c-0001"][2]),
    "matan-c-0003": V1["matan-c-0003"],
    "matan-c-0004": ("Критерий Коши сходимости последовательности.",
                     r"\(\forall\varepsilon>0\ \exists N\ \forall m,n>N:\ |x_m-x_n|<\varepsilon\)", "matan.tex:800-820"),
}


def build(cards: dict, path: str, deck_id=DECK_ID, model=MODEL):
    deck = genanki.Deck(deck_id, DECK_NAME)
    for cid, (q, a, s) in cards.items():
        deck.add_note(genanki.Note(model=model, fields=[q, a, s], guid=guid(cid), tags=[cid.replace("-c-", "-t-")]))
    genanki.Package(deck).write_to_file(path)
