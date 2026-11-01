# Дослідження для завдань з інвойсів

**Перевірено:** 2026-10-21  
**Повноваження:** контракт — [docs/specs/001-invoice-processing-system.md](../specs/001-invoice-processing-system.md). План уже розклав роботу. Ці нотатки підтверджують план і фіксують практики, які історії блокують тестами. Вони не додають сервіс, таблицю, ендпоінт чи четвертий інструмент агента.

Англійський оригінал: [research-notes.md](research-notes.md).

## 1. Моделі Gemini

Джерела, прочитані 2026-10-21:

- [Застарівання Gemini API](https://ai.google.dev/gemini-api/docs/deprecations). `text-embedding-004` вимкнено 14 січня 2026. Заміна на тій сторінці: `gemini-embedding-2`. У `gemini-2.5-flash` немає дати вимкнення на Developer API. Доступ до моделей 2.5 обмежено ключами, які вже їх викликали. Новим проєктам Google радить `gemini-3.5-flash-lite` або `gemini-3.8-flash`.
- [Моделі Gemini API](https://ai.google.dev/gemini-api/docs/models) — та сама примітка про доступ.
- [Життєвий цикл моделей Vertex](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions). Vertex виводить `gemini-2.5-flash` 20 жовтня 2026. Ця сторінка не керує репозиторієм: специфікація викликає Developer API через `GEMINI_API_KEY`.
- [Журнал змін](https://ai.google.dev/gemini-api/docs/changelog). Запис від 14 січня 2026: `text-embedding-004` вимкнено.

Зафіксовано:

- Витяг і асистент викликають `gemini-2.5-flash`, доки не задано `GEMINI_MODEL`.
- Єдиний замінний ідентифікатор — `gemini-3.8-flash`, і лише через цю змінну. `gemini-3.5-flash-lite` у код не додається.
- Невдалий живий виклик не повторюється на іншій моделі. Інвойс стає `failed` з текстом провайдера, або чат надсилає подію `error`.
- Vertex не викликається.

## 2. Ембединги

Джерело: [Embeddings](https://ai.google.dev/gemini-api/docs/embeddings). Те саме підтверджує [запис у блозі Google про Gemini Embedding 2](https://developers.googleblog.com/en/building-with-gemini-embedding-2/).

| Що пише сторінка | Правило історії |
|---|---|
| `gemini-embedding-2` не приймає `task_type`. Завдання пишуть префіксом у тексті. | Запит: `task: question answering \| query: {запит}`. Документ: `title: {title} \| text: {chunk}`. Без назви — `none`. |
| Пара «питання — уривок» є асиметричною і призначена для відповідей на питання. | Саме ця пара. Не `sentence similarity`. |
| Типовий розмір — 3072. `output_dimensionality: 768` — документований рекомендований розмір. Усічені вектори модель нормалізує сама. | Передавати 768. У коді застосунку не нормалізувати повторно. Вектор іншої довжини відхиляти. Колонка лишається `vector(768)`. |
| Список сирих рядків дає один агрегований вектор. Окремі вектори потребують об'єкта `Content` на кожен вхід або Batch API. | Усе одно один чанк на один запит. Масив чанків не передавати. Форму з кількома `Content` у цій фічі не вмикати. |

`chunk_content` зберігає чанк без префікса.

## 3. Структурований витяг

Джерела:

- [Structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output). Nullable у JSON Schema — це `"type": ["string", "null"]`. І `gemini-2.5-flash`, і `gemini-3.8-flash` уміють структурований вивід.
- [Обговорення Prism про `response_schema` і `response_json_schema`](https://github.com/prism-php/prism/issues/974). Поле protobuf `response_schema` відповідає HTTP 400 на масив типів для null і на вкладений `additionalProperties`. `response_json_schema` приймає обидва. План уже вимагає `responseJsonSchema`.
- [Thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking). Для `gemini-2.5-flash` значення `thinkingBudget: 0` вимикає роздуми. Типово ввімкнені динамічні роздуми, і вони з'їдають бюджет AS-001 ще до JSON. Gemini 3 і Gemini 4 чекають `thinkingLevel`. `thinkingBudget` на цих моделях може дати 400. Правило плану це закриває: один повтор того самого запиту без `thinkingConfig`, далі помилка. Гілку `thinkingLevel` не додавати.
- [@google/genai 2.30.0](https://www.npmjs.com/package/@google/genai), реліз 14 жовтня 2026. Пакунок попереджає, що 3.0.0 прибирає поля. Лишатися на 2.x (`2.30.0` або новіший 2.x на момент історії). Не ставити `@google/generative-ai`.
- [Обробка документів](https://ai.google.dev/gemini-api/docs/generate-content/document-processing). Для разового витягу на Developer API файл іде inline. Межа застосунку — 20 МБ, межа inline PDF — 50 МБ. У File API інвойс не завантажувати.

Що блокує історія екстрактора:

- Температура 0.
- Надіслати JSON Schema, потім розібрати `response.text` тією самою Zod-схемою. Гарантія провайдера не замінює цей розбір.
- Якщо `zod-to-json-schema` віддає `anyOf` для nullable, переписати вузли на `"type": ["string", "null"]` до запиту. Юніт-тест фіксує цю форму.
- Промпт трактує байти файлу як дані, не як інструкції. Суми переписуються з документа. Підсумок не вигадується додаванням рядків. Мовчазне поле лишається null. Дата стає `YYYY-MM-DD` лише коли порядок однозначний.
- Розбіжність суми рядків і підсумку не валить інвойс і не додає колонок. [Нотатка про детермінований фінансовий вивід](https://www.inspireailab.com/blog/deterministic-llm-output-finance-tax) пояснює, чому суми рахує SQL. Прогалину записати в README, як уже каже план.

## 4. LangGraph v1

Джерела:

- [Міграція LangGraph v1](https://docs.langchain.com/oss/javascript/migrate/langgraph-v1). `createReactAgent` застарів. `createAgent` живе в пакеті `langchain`. Node 18 відкинуто. Потрібен Node 22 або новіший.
- [Міграція LangChain v1](https://docs.langchain.com/oss/javascript/migrate/langchain-v1). Аргумент промпта називається `systemPrompt`.
- [Персистентність](https://docs.langchain.com/oss/javascript/langgraph/add-memory). `PostgresSaver.fromConnString`, потім один виклик `setup()`. План робить це під час старту. Таблиці чекпоінтів не пишуться руками в `init.sql`.
- [langgraphjs #1808](https://github.com/langchain-ai/langgraphjs/issues/1808) і [PR #2566](https://github.com/langchain-ai/langgraphjs/pull/2566), злито 22 червня 2026. `createAgent` разом із `PostgresSaver` падав на циклічному JSON і на відсутності `versions_seen` під час відновлення. Виправлення додає `toJSON()` і підставляє порожні мапи. Ставити реліз `@langchain/langgraph-checkpoint-postgres`, який містить цей фікс. 1.1.0 від 12 жовтня 2026 — поточна лінія поруч із `@langchain/langgraph` 1.5.1 від 16 жовтня 2026.
- [Потоки подій](https://docs.langchain.com/oss/javascript/langchain/event-streaming). `streamEvents(..., { version: "v3" })` дає проєкції повідомлень і викликів інструментів. Їх треба відобразити на імена плану: `meta`, `token`, `tool_start`, `tool_end`, `done`, `error`. Сирий потік LangChain у браузер не віддавати.
- [Нотатка форуму про `recursionLimit`](https://forum.langchain.com/t/what-does-recursionlimit-actually-count-in-createagent-langchain-js/3460). Ліміт рахує суперкроки графа, не виклики інструментів. Хід моделі плюс раунд інструментів — це близько двох суперкроків. Ліміт 12 лишається. `GraphRecursionError` стає подією чату `error`, а не тихим повтором.

Підтвердження людини перед інструментом запису — поширена практика. Ця специфікація її не використовує. `retry_failed_invoice` виконується, коли модель його викликає. Пігулка в інтерфейсі з'являється після факту.

## 5. KafkaJS і Redpanda

Джерела:

- [kafkajs на npm](https://www.npmjs.com/package/kafkajs). Останній стабільний реліз — 2.2.4 від 27 лютого 2023. Станом на 21 жовтня 2026 новішого немає.
- [KafkaJS #1753](https://github.com/tulios/kafkajs/issues/1753), досі відкритий. Проєкт у режимі супроводу. В коментарях згадують клієнт Confluent і `@platformatic/kafka`. Клієнт Confluent нативний. У Platformatic був баг Redpanda `SyncGroup` v4, виправлений у березні 2026 ([platformatic/kafka #51](https://github.com/platformatic/kafka/issues/51)). План усе одно обирає KafkaJS: чистий JavaScript, без кроку збірки, і він говорить API цієї Redpanda. У цих історіях клієнта не міняти.
- [Клієнти Kafka у Redpanda](https://docs.redpanda.com/streaming/current/develop/kafka-clients/), сторінку змінено 17 вересня 2026. KafkaJS досі в переліку перевірених клієнтів Node.js.
- [Споживання](https://kafka.js.org/docs/consuming). Типовий `sessionTimeout` — 30000, типовий `heartbeatInterval` — 3000, і він має бути меншим за таймаут сесії.
- [KafkaJS #1396](https://github.com/tulios/kafkajs/issues/1396). Позиція супровідника: heartbeat, який іде, поки обробник завис, ховає мертвого споживача. План усе одно вимагає `heartbeat()` під час виклику Gemini, з інтервалом коротшим за `heartbeatInterval`, бо вивід на 5–20 секунд інакше виб'є сесію близько 45 секунд і повідомлення доставлятиметься знову. `sessionTimeout` лишається близько 45 секунд. Не піднімати його до хвилин. Падіння процесу зупиняє heartbeat, тож мертвий процес усе ще видно. Виклик `heartbeat` обробника KafkaJS ігнорує, доки інтервал не минув ([#156](https://github.com/tulios/kafkajs/issues/156)).
- [KafkaJS #1764](https://github.com/tulios/kafkajs/issues/1764). Паралельний `eachBatch` і окремий цикл heartbeat давали дублікати й ребаланси. Обробляти одне повідомлення за раз. `autoCommit: false`. Зсув комітити після коміту транзакції, яка записала `completed` або `failed`.

Сервіс Redpanda копіювати зі специфікації §6, включно з образом `docker.redpanda.com/redpandadata/redpanda:v24.1.1` і адресою `OUTSIDE://localhost:9092`. Процес на хості з'єднується з `localhost:9092`. Якщо образ не тягнеться, зупинитися. Єдина дозволена заміна образу — новіший тег `redpandadata/redpanda` з тими самими портами й тією самою адресою. Якщо перевірка `rpk cluster health` не стає здоровою, єдина дозволена правка — команда healthcheck.

## 6. pgvector

Джерела:

- [pgvector](https://github.com/pgvector/pgvector).
- [Індекси EDB](https://www.enterprisedb.com/docs/pg_extensions/pgvector/using). До близько мільйона рядків послідовне сканування часто швидше за HNSW і є точним.
- [Усунення несправностей pgvector](https://pgvector.app/troubleshooting/). `ORDER BY embedding <=> $1 LIMIT n` може скористатися індексом `vector_cosine_ops`. `ORDER BY 1 - (embedding <=> $1) DESC` — ні. На малій таблиці планувальник усе одно може обрати послідовне сканування. Нульові вектори для косинусної відстані не індексуються.

Зафіксовано:

- Індекс HNSW лишається `m = 16`, `ef_construction = 64`, `vector_cosine_ops`.
- Подібність вибирати як `1 - (embedding <=> $1)`. Сортувати за оператором відстані за зростанням, з `LIMIT`.
- Тести перевіряють порядок сусідів, не вузол `EXPLAIN`.
- Фейковий ембедер повертає ненульовий одиничний вектор на 768 вимірів. Нульовий вектор косинусний індекс не побачить.

## 7. Завантаження файлів

Джерела:

- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html). Дозволяти лише потрібні типи, не довіряти `Content-Type`, генерувати ім'я, обмежити розмір, не віддавати каталог статичним middleware.
- [Необмежене завантаження в Express](https://softwaresecurity.com/fix/file-upload/node-express/). `file.mimetype` пише клієнт. `limits.fileSize` типово безмежний. Multer не вішати глобально. З multer 2.3.0 файл рівно на межі приймається; раніший 2.x відхиляв рівність. Авторитет — перевірка застосунку: довжина `<= 20 * 1024 * 1024` приймається, на байт більше — 413.
- Нотатки про магічні байти з того самого розбору і з [перевірки magic number](https://transloadit.com/devtips/secure-api-file-uploads-with-magic-numbers/). Сигнатура не є вердиктом про шкідливість. Цьому завданню потрібні сигнатура, згенероване ім'я і замкнений шлях. Антивірус і перекодування зображень не додаються.

Сигнатури:

| Заявлений тип | Сигнатура |
|---|---|
| `application/pdf` | байти починаються з `%PDF` |
| `image/png` | `89 50 4E 47 0D 0A 1A 0A` |
| `image/jpeg` | `FF D8 FF` |

`image/jpg` не приймається. Об'єкт на диску — `<uuid>.<ext>` з розширенням виявленого типу (`.pdf`, `.png`, `.jpg`). `original_name` — лише базове ім'я. У збереженому і показаному значенні немає ні `/`, ні `\`.

Multer 2.x. Файл тримати в пам'яті, доки сигнатура не зійдеться, і лише тоді писати на диск. Відхилене завантаження не залишає ні рядка, ні файлу. Multer змонтовано лише на `POST /api/invoices/upload`.

PDF із паролем воркер упізнає за ASCII-маркером `/Encrypt` до будь-якого виклику Gemini. Це сканування байтів, не парсер, який виконує JavaScript документа. `error_message` каже, що файл зашифрований. Файл, який воркер не може прочитати, стає `failed` з повідомленням, що він нечитабельний. Маршрут завантаження вже відхилив погану сигнатуру, тож гілка воркера — для байтів, які підпис пройшли, але лишились обрізаними або непридатними.

## 8. SSE і проксі Vite

Джерела:

- [WHATWG server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html). `EventSource` працює лише з GET. Повторне з'єднання вбудоване. Рядок, що починається з `:`, є коментарем і звичним heartbeat.
- [Обговорення Vite #10851](https://github.com/vitejs/vite/discussions/10851). Проксований SSE часто приходить одним шматком у кінці, доки відповідь не має `X-Accel-Buffering: no`.
- [Vite server.proxy](https://vite.dev/config/server-options). Гак `configure` є підтримуваним. Якщо буфер лишається, проєкти ставлять `selfHandleResponse: true` і пишуть кожен шматок окремо.

Зафіксовано:

- Потік інвойсів: `GET /api/events/invoices`, браузерний `EventSource`.
- Потік чату: `POST /api/chat`, `fetch`, читання тіла. Для чату `EventSource` не використовувати.
- Заголовки обох потоків: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
- Коментар кожні 15 секунд (`: ping`).
- Журналу повтору на сервері немає. Під час з'єднання і повторного з'єднання клієнт вантажить `GET /api/invoices`, а подію SSE застосовує лише коли її `updatedAt` новіший за рядок у стані. `Last-Event-ID` ігнорувати.
- Vite проксює `/api` на порт 3001. Браузер кличе лише `/api/...`. Якщо тест Playwright бачить токени лише після `done`, лагодити змив проксі. Імена подій не змінювати.

## 9. Гібридний пошук

Нотатка плану про фінанси збігається з поточною практикою: JSON-схема гарантує форму, а не те, що надрукований підсумок прочитано правильно, і LLM — поганий калькулятор для кількостей і сум. Інструментів лишається три:

- `get_invoice_statistics_and_list` — один фіксований SQL, зв'язані параметри, без SQL-рядка від моделі.
- `search_invoices_vector` — косинусний пошук по чанках.
- `retry_failed_invoice` — та сама функція повтору, що й HTTP-маршрут.

Інструмента масового повтору немає. Кілька рядків модель повторює окремим викликом на кожен id після того, як статистика їх перелічила. `limit` векторного пошуку типово 5 і не більший за 10.

Фільтр постачальника: екранувати `%`, `_` і `\` перед шаблоном `ILIKE`. Збіг із `extracted_data.vendor.name`. Нечисловий `totalAmount` пропускається. `total_sum` змішує валюти, бо затверджений запит їх не групує. Це обмеження йде в README. Інструмент групування не додавати.

## 10. Версії

Зафіксувати розв'язані версії в lockfile, коли US-001 і пізніші історії їх ставлять.

| Пакунок | Пін | Навіщо |
|---|---|---|
| Node | `>=22`, `.nvmrc` = `22` | LangGraph v1 відкинув Node 18. |
| `kafkajs` | точно `2.2.4` | Останній реліз. Клієнт плану. |
| `@google/genai` | `2.30.0` або новіший 2.x нижче 3.0.0 | 3.0.0 прибирає API. Старий SDK не використовувати. |
| `langchain`, `@langchain/langgraph` | поточний 1.x, де є `createAgent` | API v1. 1.5.1 був поточним для langgraph 16 жовтня 2026. |
| `@langchain/langgraph-checkpoint-postgres` | 1.x із PR 2566 | Баг відновлення `createAgent` + `PostgresSaver`. 1.1.0 був поточним 12 жовтня 2026. |
| `zod` | один мажор, той, який уже приймає `langchain@1.5` (`^3.25.32` або `^4.2.0`) | Два мажори в одному пакунку зламають схеми інструментів. |
| `multer` | 2.x | План. Не 1.x. |
| `pg` | поточний 8.x | Пул для SQL і звичний сусід `PostgresSaver`. Без ORM. |
| React | 18 або 19 | Специфікація. Vite, Tailwind, Lucide, React Router. |
| Playwright | поточний 1.x | Браузерний доказ для CP-4, CP-5, CP-8. |
| Vitest | 5.x (`5.0.5` або новіший) | **Припущення:** раннер юніт- і інтеграційних тестів. План називає npm-скрипти, не раннер. 3.2 і 4.1.x входять у діапазон порад щодо tinypool і `@vitest/mocker`; 5.0.5 — виправлений реліз. |
| `pdf-lib` | поточний | Генератор зразка. Не парсер PDF на шляху завантаження. |

## Чого це дослідження не змінює

Автентифікацію, режим фікстур на продуктовому сервері, об'єктне сховище, другого воркера, додаткові топіки, додаткові інструменти, Tesseract, `vector(768)`, параметри HNSW, перелік статусів, конвертацію валют, крок підтвердження перед повтором, пошту, і будь-яке редагування специфікації чи `.cursor/rules/sdlc/`.
