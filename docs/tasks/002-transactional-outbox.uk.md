# Tasks: Transactional outbox for PROCESS_INVOICE

**Plan:** `.sdlc/specs/002-transactional-outbox/plan.md`  
**Date:** 2026-10-23

## User Stories

### US-001: Схема і запити outbox

**As a** сервер  
**I want** зберігати подію обробки поруч із інвойсом  
**So that** commit рядка вже означає, що завдання не втрачене

**Acceptance Criteria:**
- [ ] `server/src/db/init.sql` створює `invoice_outbox` через `CREATE TABLE IF NOT EXISTS`: `id UUID PRIMARY KEY`, `invoice_id UUID NOT NULL REFERENCES invoices (id) ON DELETE CASCADE`, `payload JSONB NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `published_at TIMESTAMPTZ`
- [ ] Частковий індекс `idx_invoice_outbox_unpublished` на `(created_at)` де `published_at IS NULL`
- [ ] `insertOutbox` пише `id`, `invoice_id`, `payload`
- [ ] `listUnpublishedOutbox` читає `id`, `invoice_id`, `payload` де `published_at IS NULL`, порядок `created_at ASC, id ASC`, і парсить payload через `ProcessInvoiceEventSchema` (битий payload кидає, не пропускається)
- [ ] `markOutboxPublished` виконує `UPDATE ... SET published_at = NOW() WHERE id = $1 AND published_at IS NULL`
- [ ] `listUploadedMissingOutbox` повертає `id`, `file_path`, `mime_type` лише для `status = 'uploaded'` без жодного рядка outbox
- [ ] Юніт-тест фейковим клієнтом перевіряє SQL, параметри і розбір payload

**Files likely touched:**
- `server/src/db/init.sql`
- `server/src/db/outbox.ts`
- `server/src/db/outbox.test.ts`

---

### US-002: Relay

**As a** користувач із зависшим `uploaded`  
**I want** щоб сервер сам повторно клав завдання в чергу  
**So that** збій брокера або смерть процесу між commit і send не лишав вічну картку

**Acceptance Criteria:**
- [ ] `drainOutbox(pool, publisher)` спочатку в окремій закоміченій транзакції вставляє по одній події на кожен рядок із `listUploadedMissingOutbox`; `eventId` дорівнює id outbox; шлях і MIME беруться з інвойса; `timestamp` — `toISOString()`
- [ ] Далі читає неопубліковані і для кожного викликає `publisher.publish(invoiceId, payload)`, і лише потім `markOutboxPublished`
- [ ] Виняток `publish` не ставить `published_at` і не публікує наступні рядки цього проходу; наступний `drainOutbox` шле той самий рядок
- [ ] Успішно позначений рядок другий drain не шле
- [ ] Інвойс, у якого outbox уже є, добором не дублюється
- [ ] Паралельні виклики не виконують два проходи одночасно; виклик під час поточного проходу виконує ще один прохід після нього
- [ ] `startOutboxRelay` одразу робить один drain, далі кожні 1000 мс; помилка логується через `console.error` і не прокидається назовні зі старту; `stop()` знімає інтервал
- [ ] Юніт-тести покривають успіх, повтор після винятка, відсутність другого publish і відсутність дубля добору

**Files likely touched:**
- `server/src/services/outbox-relay.ts`
- `server/src/services/outbox-relay.test.ts`

---

### US-003: Завантаження і retry через ту саму транзакцію

**As a** користувач  
**I want** щоб прийнятий файл або натиснутий retry лишались у черзі навіть коли брокер ліг після запису в базу  
**So that** я не мусив видаляти картку і завантажувати файл знову

**Acceptance Criteria:**
- [ ] `commitUploadedInvoice` на одному `PoolClient` робить `BEGIN`, `insertUploadedInvoice`, `insertOutbox`, `COMMIT`; `publish` всередині цієї транзакції не викликається
- [ ] `insertUploadedInvoice` приймає `Pool | PoolClient`
- [ ] Збій insert outbox робить `ROLLBACK`. `receiveInvoiceUpload` прибирає щойно збережений файл і не повертає `202`
- [ ] Після успішного commit upload викликає `drainOutbox`. Якщо drain кидає, помилка логується, файл і рядок лишаються, відповідь усе одно `202`, SSE `uploaded` усе одно йде
- [ ] Компенсація видаленням рядка після publish прибрана. `broker_unavailable` прибраний з `UploadFailure` і з мапи статусів маршруту
- [ ] `commitRetry` на одному клієнті переводить `failed` → `uploaded` (порожній `error_message`, `retry_count + 1`) і вставляє outbox. Якщо `transitionInvoice` повернув `undefined`, `ROLLBACK` і outbox немає
- [ ] `retryInvoice` після commit викликає `drainOutbox` так само, як upload. Помилка drain не повертає `failed` і не дає `503`. Успіх — `200`. Статус не `failed` — як і раніше `404` або `409`, без outbox
- [ ] `server/src/index.ts` створює один publisher, передає його і в `startOutboxRelay`, і в застосунок. Другий producer не створюється
- [ ] Юніт-тести: порядок `BEGIN`/insert/COMMIT проти `publish`; відкат файлу; успіх upload і retry попри виняток publisher; `409` без outbox

**Files likely touched:**
- `server/src/services/enqueue-invoice.ts`
- `server/src/services/enqueue-invoice.test.ts`
- `server/src/services/upload-invoice.ts`
- `server/src/services/upload-invoice.test.ts`
- `server/src/services/retry.ts`
- `server/src/services/retry.test.ts`
- `server/src/routes/invoice-upload.ts`
- `server/src/db/invoices.ts`
- `server/src/index.ts`

---

### US-004: Інтеграційні тести старого контракту 503

**As a** перевірка `make verify`  
**I want** щоб тести описували новий контракт  
**So that** зелений прогін не вимагав знищення інвойса після помилки брокера

**Acceptance Criteria:**
- [ ] `server/test/upload.integration.test.ts`: коли publisher кидає, відповідь `202`, рядок `uploaded` є, файл є, `published_at` порожній
- [ ] `server/test/upload-events.integration.test.ts`: той самий збій дає `202`, SSE `uploaded` для цього id, файл і рядок на місці
- [ ] `server/test/retry-scenarios.ts`: `expectRestoredFailure` замінений на очікування `200`, статусу `uploaded`, збільшеного `retry_count`, порожнього `error_message`, SSE і неопублікованого outbox
- [ ] Щасливий retry як і раніше публікує одне завдання (`jobs.count` дорівнює 1)
- [ ] Клієнтські мапи `broker_unavailable` не змінюються

**Files likely touched:**
- `server/test/upload.integration.test.ts`
- `server/test/upload-events.integration.test.ts`
- `server/test/retry-scenarios.ts`

---

## Implementation Order

1. US-001 (немає залежностей)
2. US-002 (залежить від US-001)
3. US-003 (залежить від US-001 і US-002)
4. US-004 (залежить від US-003)

## Definition of Done

- [ ] Усі критерії приймання пройдені
- [ ] `make verify` проходить
- [ ] У змінених файлах немає TODO/FIXME
- [ ] Новий код імпортований і викликається
- [ ] `docs/architecture.md` описує outbox як поточну поведінку, а зворотне вікно лишає єдиною розбіжністю цього пункту
