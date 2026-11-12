# Tech debt

Реестр для `/debt scan` и `/debt fix`.

## Config
- check: `npm run check` — tsc --noEmit, ~3 с
- check: `npm test` — vitest, 234 теста, ~6 с
- check: `cd tools/anki && .venv/bin/python -m unittest` — тесты Anki-инструментов (venv только в основной копии), ~2 с
- exclude: `engine/spike/*` `tools/anki/spike/*` `engine/src/ui/i18n/ru.ts` `engine/src/ui/i18n/en.ts`
- last-scan: 2026-11-12 @ 8a547a0

Горячая точка по-прежнему одна — `tools/pack/build-pack.ts`: 21 коммит, CCN 203 → 199 после D-012, 369 строк. Делить файл рано; если перевалит за ~500 строк — завести design-пункт о разбиении по разделам пака. Остальные файлы: 2–6 коммитов (кроме `schema.ts`, 15 коммитов, но CCN 39 — это схемы, не логика), их ранг — просто сложность. Функции с CCN 16–20 (`Today`, `subjectReady`, `api`, `Editor`, `Theory`, `buildTickets`, `buildItems`, `buildPack`, `check*Tests`) читаются линейно — не пункты. Незавершённых веток с изменениями нет (все task/* и debt/2026-11-12 влиты в dev).

## Open


## Needs decision

## Done
- [D-016] 2026-11-12 — `agent/diff.ts`: из `report` вынесены `itemChanges`, `answerChanges`, `subjectLines` (CCN 26 → 3, максимум 14); вывод на реальных данных в 8 сценариях побайтно тот же.
- [D-017] 2026-11-12 — `report.py`: `collect` разбит на `read_cards`, `lapses_by_tag`, `card_edits` (CCN 22 → ≤8); вывод на фикстуре test_report побайтно тот же.
- [D-015] 2026-11-12 — чтение JSON (`ENOENT → null`) и атомарная запись документа вынесены в `tools/lib/json-files.ts`, общий для сервера и синхронизации.
- [D-014] 2026-11-12 — upsert документа с `updatedAt` в `update` вынесен в `upsertDoc` (`store/types.ts`), общий для capacitor- и http-хранилищ.
- [D-013] 2026-11-12 — `parse-md.ts`: разбор front-matter вынесен в `splitFrontMatter`, общий для тестов и карточек; сообщения об ошибках прежние.
- [D-012] 2026-11-12 — `build-pack.ts`: обход вопросов теста (`testQuestions`) и проверка «билет в допустимом множестве / L2 только L2» (`checkQuestions`) общие для тестов-тем и тестов-билетов; тексты ошибок прежние.
- [D-011] 2026-11-12 — `report.py`: срывы за 7 дней ищут карточку по словарю `cid → card`, из запроса убраны join notes и неиспользуемый `n.tags`.
- [D-010] 2026-11-12 — сняты `export` у 11 констант/функций, используемых только внутри своих файлов (coverage, schema, sdachi, build-pack, server, from-artifact).
- [D-004] 2026-11-09 — удалена одноразовая миграция `tools/pack/from-v0*.ts` (решение пользователя; код остаётся в git-истории).
- [D-003] 2026-11-09 — подписи и класс срока строки вынесены из `ItemRow` в чистые `rowMeta`/`dueClass` с тестами (CCN 20 → 9).
- [D-009] 2026-11-09 — сообщение о дубликате id карточки называет файл один раз; тест.
- [D-008] 2026-11-09 — общий обход `subjectMdFiles` и обёртка ошибок `atPath` для тестов, карточек и теории (−29 строк, вывод пака не изменился).
- [D-007] 2026-11-09 — цикл теории вынесен из `buildPack` в `buildTheory`.
- [D-002] 2026-11-09 — цикл элементов вынесен из `buildPack` в `buildItems`, поиск id для сообщения — в `itemIdAt`.
- [D-006] 2026-11-09 — удалены неиспользуемые импорты `shutil`, `defaultdict` в `tools/anki/report.py`.
- [D-005] 2026-11-09 — сняты `export` с внутренних схем `schema.ts` и `PART_SEP`.
- [D-001] 2026-11-08 — убраны неиспользуемые экспорты `KINDS` (реэкспорт), `ItemSchema`, `EMPTY_PACK`, `lang`.

## Won't fix
- `engine/spike/sp1.tsx` — knip считает файл неиспользуемым, но он подключён из `engine/sp1.html` (проба SP-1 в `docs/spikes/`).
- `tools/pack/dump-pack.ts` — knip: «unused file», но это CLI, описанный в `docs/architecture/02-data.md`.
- Неиспользуемые экспорты типов (`Pack`, `ItemsFile`, `DueState`, `Kind`, `Override`, `ViewExam`, `Thresholds`, `Card`, `TheoryEntry`, `MissingReady`, `Raw*`) — типы описывают модель и не стоят ничего в рантайме.
- Повторы в тестах (`tests-run.test.ts`, 7–8 строк) и 6 строк `ready/index.tsx` ↔ `theory/index.tsx` — меньше порога, выделение ухудшит читаемость.
- ruff в `tools/anki/build.py` (сортировка импортов, `re.S`) — стиль, не долг.
- ruff PLW2901 в `tools/anki/test_build.py:37` и `tools/anki/test_report.py:34` (`temp = Path(temp)`) — идиома в тесте, не долг.
- Повтор `subscribe` в `store/capacitor.ts:102` ↔ `store/http.ts:56` (7 строк, общая только регистрация подписчика; дальше логика разная) — меньше порога.
- Повторы в тестах `tests.ui.test.tsx:150↔201` (10 строк), `frozen.ui.test.tsx↔sdachi.ui.test.tsx` (7 строк, общая подготовка) — тестовые сценарии, выделение ухудшит читаемость.
