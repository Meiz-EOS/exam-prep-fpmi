# 02. Данные: пакет, прогресс, слияние, чтение агентом

## Курс-пакет {#pack}

```
packs/igor-2026w/
  pack.yaml            id пакета, название, семестр, предметы (id, имя, порядок), экзамены
  items/<предмет>.yaml пункты сдач предмета
  cards/<предмет>/*.md (E-3)   tests/<предмет>/*.md (E-4)   theory/<предмет>/*.md (E-5)
```

Личное — ссылки на сообщения чатов (`private/notes.yaml`), снимки агента (`private/last-seen*.json`), конфиг синхронизации (`sync.yaml`) — лежит не в пакете, а в папке данных: `<dataDir>/<пакет>/private/`, `<dataDir>/<пакет>/sync.yaml` ([13-classmates.md#private](13-classmates.md#private)); в сборку не входит (Н-6, Р-11). `build-pack` по-прежнему пропускает `private/` внутри пакета, если он там окажется (`.gitignore` его отсекает).

**`pack.yaml`:**
```yaml
id: igor-2026w
title: Зимняя сессия 2026/27
subjects:
  - { id: aig, name: АиГ }
  - { id: matan, name: матан }
  - { id: aisd, name: АиСД }
  - { id: cpp, name: C++ }
  - { id: oktch, name: ОКТЧ }
exams:
  - { id: ex-aig, subject: aig, title: АиГ, date: 2026-12-26 }
```

**`items/aig.yaml`** — группы с пунктами; группа задаёт общее для пунктов:
```yaml
- group: АиГ задание 2 · неделя 1
  kind: дз-задача
  items:
    - { id: aig2-w1-01, title: С 16.22 }
    - { id: aig2-w1-04, title: С 16.40, star: true }
- group: АиГ задание 2
  items:
    - { id: aig2-submit, kind: дз, title: "Задание 2: сдать тетрадь", soft: 2026-11-10, hard: 2026-11-16, note: "бумага до 17:00 или скан до 23:59" }
```

Порядок пунктов в файле и есть порядок на странице (поле `order` не нужно).

## Схемы и проверка {#schema}

Схемы `zod` в `engine/src/content/schema.ts`. Типы TS выводятся из них (`z.infer`). Проверка при сборке пакета (`tools/pack/build-pack.ts`):
- все поля по схеме, даты в формате `YYYY-MM-DD`, `soft ≤ hard`;
- **id уникальны во всём пакете**, сегменты id — `[a-z0-9-]`;
- `subject` ссылается на существующий предмет;
- ошибка → сборка падает с путём файла и id пункта.

## Прогресс в базе {#progress}

Коллекция **`items`**, id документа = id пункта пакета (те же, что у v0).

| Поле | Тип | Кто пишет |
|---|---|---|
| `status` | `не начато` / `в работе` / `сдано` / `принято` / `доработка` | студент |
| `score` | число или строка, необязательно | студент |
| `note` | строка | студент |
| `override` | `{ soft?, hard?, title? }` — правка с телефона (Р-4) | студент; агент очищает после переноса в пакет |
| `custom` | `true` — пункт добавлен студентом, его нет в пакете | страница |
| `subject, kind, title, group, soft, hard` | только у `custom` | страница |
| `updatedAt` | ISO-время последней записи | страница / агент |

Документы v0 содержат ещё поля каталога (`title`, `group`, `soft`, `order`, …) — v1 их **игнорирует** у пунктов, которые есть в пакете.

## Слияние пакета и прогресса {#merge}

Чистая функция `core/merge.ts`: `(pack, progressDocs) → view`.
1. Пункт пакета + его документ прогресса → поля каталога из **пакета**, затем поверх — `override` (с пометкой «изменено тобой»), статус и прочее — из прогресса. Нет документа → `не начато`.
2. Документ с `custom: true` → отдельный пункт со своими полями.
3. Документ без `custom`, id которого нет в пакете → **осиротевший**: показывается в группе «Без пакета» и попадает в сводку агента, а не теряется молча.

Экзамены — из `pack.yaml`, их прогресс (оценка) — документ `items/<id экзамена>`.

## Прогоны тестов {#attempts}

Коллекция **`attempts`** (E-4; формат ответа и самооценка — [04#tests](04-knowledge.md#tests)). Один документ на прогон, все ответы внутри (лимит документа 256 КиБ — на прогон хватает с запасом):
```ts
{ test: "aig-entry", startedAt, finishedAt?, answers: [
  { q: "aig-q-017", text: "…", hits: [0, 2], gross?: true, self: 0.67, agent?: 0.5, agentNote?: "…", at: ISO } ] }
```
`agent`/`agentNote` дописывает агент после разбора (С-4а).

## Как агент читает прогресс {#agent}

**Версия для ПК (с W5, [07#agent](07-standalone.md#agent)).** Прогресс — файлы в `../zachetka-data/igor-2026w/` (далее `$D`), отдельный git. ArtifactData не нужен.

В начале сессии:
1. Зафиксировать отметки студента: `git -C ../zachetka-data add -A && git -C ../zachetka-data commit -qm "<дата>: отметки"` (если есть изменения; коммиты без упоминаний ИИ).
2. Сравнение с пакетом: `node tools/agent/diff.ts --data $D --pack packs/igor-2026w` — что сменило статус с прошлой проверки, новые заметки, `override` (предложить перенос в пакет), осиротевшие id, `custom`-пункты, новые ответы тестов. Помнит прошлую проверку в `<папка данных>/private/last-seen*.json`. Без `--data`/`--pack` берёт их из настроек ([13-classmates.md#settings](13-classmates.md#settings)).
3. Дата последней проверки записывается в `mipt/экзамен/подготовка/сроки.md` (как сейчас).
4. Снять Anki-отчёт и записать документ дня прямо в папку данных:
   ```sh
   node tools/pack/dump-pack.ts packs/igor-2026w > /tmp/pack.json
   tools/anki/.venv/bin/python tools/anki/report.py collection.anki2 /tmp/pack.json --json > /tmp/anki-report.json
   node tools/agent/today.ts --pack packs/igor-2026w --anki /tmp/anki-report.json \
     --plan-file /path/to/plan.json --write $D/meta/today.json
   ```
   `--plan` принимает JSON-массив напрямую вместо `--plan-file`. Скрипт проверяет тело по `TodayDocSchema` и пишет файл атомарно (с `updatedAt`); открытая вкладка покажет план при возврате на неё.
5. Правка ответа теста агентом (`agent`, `agentNote`) — правка файла `$D/attempts/<id>.json`.

В конце сессии — снова `git commit` папки данных (свои записи агента).

Статусы C++ и АиСД из источников курса сервер подтягивает сам при старте и раз в час ([12-sync.md](12-sync.md)); отчёт — в журнале сервера и в `meta/sync.json` → `last`, вручную — `npm run sync -- --dry-run`.

Импорт файла обмена (`⇅` → «Загрузить файл», [11-apk.md#ui](11-apk.md#ui)) пишет прямо в папку данных — отдельного шага нет: изменения с телефона попадают в коммит шага 1 следующей сессии, их видно в `git diff` (у документов `updatedAt` из файла). Перезапуск сервера после выпуска с новыми запросами: `tools/serve/open.sh --stop`, затем ярлык или `ZACHETKA_NO_BROWSER=1 tools/serve/open.sh`.

**claude.ai (до W5 и для снимков замороженной страницы):** `ArtifactData list items/attempts/meta` с `out_dir` → `diff.ts --docs <out_dir>/items --attempts <out_dir>/attempts --pack …`; документ дня — `today.ts` без `--write` → `ArtifactData update` (collection `meta`, doc_id `today`, `file_path`).
