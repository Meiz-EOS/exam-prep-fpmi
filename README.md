# Зачётка (exam-prep-fpmi)

Своя копия трекера подготовки к сессии: сдачи и сроки, тесты, теория по билетам, карта готовности, карточки Anki. Работает на ПК (локальный сервер + вкладка браузера) и на Android (APK). Каждый ведёт свою копию в своём форке; общего сервера и общего прогресса нет.

В репо уже есть пакет `packs/igor-2026w` — зимняя сессия 2026/27 группы Б05-618 (АиГ, матан, АиСД, C++, ОКТЧ, матлогика). Можно работать прямо в нём или завести свой.

## ПК без установки (Linux)

Если пакет `igor-2026w` подходит и ничего править не нужно: в [Releases](https://github.com/Meiz-EOS/exam-prep-fpmi/releases/latest) скачать `zachetka-linux-x64` — это всё приложение в одном файле, git и Node не нужны.

1. Разрешить запуск: ПКМ по файлу → «Свойства» → «Права» → «Разрешить выполнение как программы» (или `chmod +x zachetka-linux-x64`).
2. Запустить двойным щелчком (или `./zachetka-linux-x64`). Откроется вкладка браузера, в меню появится «Зачётка» — дальше запускать оттуда.

Прогресс — в `~/.local/share/zachetka/igor-2026w/`, не рядом с файлом: новую версию просто скачать поверх. Перенос с телефона и обратно — файлом через `⇅`.

## Быстрый старт (ПК)

Нужны git и Node.js 26.

```sh
# 1. Форк на GitHub (кнопка Fork), затем:
git clone https://github.com/<вы>/exam-prep-fpmi.git
cd exam-prep-fpmi
git remote add upstream https://github.com/Meiz-EOS/exam-prep-fpmi.git
npm ci
npm run build:local     # собрать страницу (dist/local)
npm start               # сервер на 127.0.0.1:4317 и вкладка в браузере
```

`npm start` — для Linux. На Windows и macOS: `npm run serve` и открыть http://127.0.0.1:4317/ руками.

Прогресс (отметки, ответы тестов) лежит **вне репо**, в папке `../zachetka-data/<пакет>/` рядом с клоном — один JSON на документ. Сделайте её git-репозиторием и коммитьте время от времени: это и есть резервная копия.

### Настройки (если нужно)

Без настроек всё работает: пакет — единственный в `packs/`, данные — `../zachetka-data`. Чтобы поменять, скопируйте `zachetka.local.example.json` в `zachetka.local.json` (он в `.gitignore`, при обновлении не конфликтует):

```json
{ "pack": "packs/igor-2026w", "dataDir": "../zachetka-data", "androidDir": "../android" }
```

Переменные окружения `ZACH_PACK`, `ZACHETKA_DATA`, `ZACH_ANDROID` важнее файла.

## Телефон (APK)

APK собирает GitHub Actions **вашего форка**, подписывая **вашим** ключом. Один раз: создать ключ и положить его в Secrets форка — по шагам в [docs/architecture/11-apk.md#ci](docs/architecture/11-apk.md#ci). Дальше:

```sh
git tag v1.0.0-me.1 && git push origin v1.0.0-me.1
```

APK появится в Releases форка. Ключ сохраните у себя: с другим ключом новая версия не встанет поверх, придётся переустанавливать (прогресс на телефоне перенести файлом через `⇅`).

Собрать локально тоже можно: `npm run build:apk` (нужны JDK 21 и Android SDK 36 — [11-apk.md#toolchain](docs/architecture/11-apk.md#toolchain)).

## Свой контент

- Формат пакета — [docs/pack-format.md](docs/pack-format.md): какие файлы, что в них обязательно, примеры.
- Проверка: `npm run check:pack` — все ошибки сразу, в виде `файл:строка: что не так`.
- Сгенерировать файлы пакета любой LLM по своим материалам (программа, конспект, список заданий) — готовый промпт в [docs/pack-prompt.md](docs/pack-prompt.md).
- Колода Anki: готовый `.apkg` для `igor-2026w` приложен к релизам основного репо; импортируйте в Anki, повторный импорт новой версии обновляет карточки, а не дублирует.

## Обновление

```sh
git fetch upstream && git merge upstream/main
npm ci
npm run check:pack
npm run build:local
```

Что поменялось и нужна ли миграция пакета — в [CHANGELOG.md](CHANGELOG.md). Для нового APK — новый тег в форке.

## Необязательно: агент и синхронизация

Эти части нужны тем, кто ведёт подготовку вместе с агентом (Claude Code и т. п.); без них трекер работает полностью.

- `node tools/agent/diff.ts` — короткий отчёт для агента: что изменилось в прогрессе с прошлой проверки.
- `node tools/agent/today.ts` — записать план дня в экран «Сегодня».
- `npm run sync` — статусы сдач из открытых таблиц курса, MR и PR. Конфиг личный: `<папка данных>/<пакет>/sync.yaml`, формат — [docs/architecture/12-sync.md](docs/architecture/12-sync.md). Нет файла — синхронизация выключена.

## Документы

| Документ | Что в нём |
|---|---|
| [docs/functional-spec.md](docs/functional-spec.md) | Что делает инструмент, для кого, сценарии |
| [docs/architecture/README.md](docs/architecture/README.md) | Архитектура и решения |
| [docs/roadmap.md](docs/roadmap.md) | Эпики и вехи |

Проверки перед своим коммитом: `npm run check && npm test`.

Лицензия — [MIT](LICENSE).
