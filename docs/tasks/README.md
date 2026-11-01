# Завдання: система обробки інвойсів

**Статус:** затверджено 2026-10-21. Реалізація йде по одній історії, починаючи з US-001.  
**Дата:** 2026-10-21  
**Рівень:** 2

Контракт завдань — англійський файл. Український файл є перекладом. Якщо вони розходяться, чинний англійський.

| Файл | Роль |
|---|---|
| [001-invoice-processing-system.md](001-invoice-processing-system.md) | Контракт: US-001 … US-018 |
| [001-invoice-processing-system.uk.md](001-invoice-processing-system.uk.md) | Повний український переклад |
| [research-notes.md](research-notes.md) | Дослідження, яке підтвердило план |
| [research-notes.uk.md](research-notes.uk.md) | Те саме українською |

Вказівник для SDLC лежить у `.sdlc/specs/001-invoice-processing-system/tasks.md` і не дублює історії.

## Порядок

Дев'ять контрольних точок, вісімнадцять історій. Наступна точка не починається, поки команда поточної не завершилась з кодом 0.

| Точка | Історії | Доказ |
|---|---|---|
| CP-1 Запуск | US-001, US-002 | `npm run verify` з Docker |
| CP-2 Завантаження | US-003, US-004 | інтеграційні тести, без Gemini |
| CP-3 Обробка на фейках | US-005, US-006 | `npm run test:integration:pipeline` |
| CP-4 Інтерфейс інвойсів | US-007, US-008, US-009 | `npm run test:e2e:upload` (AS-001) |
| CP-5 Повторення | US-010, US-011 | `npm run test:e2e:retry` (AS-002) |
| CP-6 Живий Gemini | US-012, US-013 | `npm run verify` без ключа |
| CP-7 API асистента | US-014, US-015 | `test:integration:chat`, `test:integration:agent-actions` (AS-003, AS-004) |
| CP-8 Чат | US-016, US-017 | `npm run test:e2e:chat` |
| CP-9 README | US-018 | `make verify` або `npm run verify` без `GEMINI_API_KEY` |

## Що дослідження не змінило

Стек, таблиці, ендпоінти і три інструменти лишились як у плані. Зафіксовано версії і практики: `kafkajs@2.2.4`, `@google/genai` 2.x, `gemini-embedding-2` на 768 вимірах, `createAgent` з `PostgresSaver`, один чанк на один запит embedding, магічні байти замість MIME браузера.

Деталі: [research-notes.uk.md](research-notes.uk.md).
