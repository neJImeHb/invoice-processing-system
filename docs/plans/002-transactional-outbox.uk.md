# Plan: Transactional outbox for PROCESS_INVOICE

**Spec:** `.sdlc/specs/002-transactional-outbox/spec.md`  
**Date:** 2026-10-23

## Approach

Бізнес-зміна і рядок `invoice_outbox` комітяться одним клієнтом Postgres. Після commit relay читає рядки з порожнім `published_at`, шле їх наявним `InvoicePublisher` і лише тоді ставить позначку. Завантаження і retry більше не компенсують невдалий `send` знищенням або відкатом статусу.

## Phases

### Phase 1: Схема і доступ до outbox

- [ ] Таблиця `invoice_outbox` і частковий індекс у `server/src/db/init.sql`
- [ ] `server/src/db/outbox.ts`: insert, список неопублікованих, позначка, вибірка `uploaded` без жодного outbox
- [ ] Юніт-тести на фейковому клієнті без Postgres

**Verify:** `npm run test:unit -w server -- src/db/outbox.test.ts`

### Phase 2: Relay

- [ ] `drainOutbox` з добором, публікацією і позначкою після send
- [ ] Ланцюжок викликів, щоб паралельні drain не йшли внакладку і новий виклик не губився
- [ ] `startOutboxRelay`: негайний drain і інтервал 1 с; помилка drain логується і не валить процес
- [ ] Юніт-тести успіху, повтору після винятка send і відсутності дубля добору

**Verify:** `npm run test:unit -w server -- src/services/outbox-relay.test.ts`

### Phase 3: Завантаження і retry

- [ ] `commitUploadedInvoice` і `commitRetry` у `server/src/services/enqueue-invoice.ts`
- [ ] `insertUploadedInvoice` приймає той самий `Pool | PoolClient`, що й `transitionInvoice`
- [ ] Upload і retry після commit викликають `drainOutbox` у `try/catch` з `console.error` і все одно відповідають успіхом
- [ ] Прибрати компенсацію `503`, видалення рядка після publish і `restoreFailed`
- [ ] Один `KafkaPublisher` у `server/src/index.ts` спільний для relay і застосунку
- [ ] Юніт-тести транзакції, відкату файлу, успіху попри помилку publish і `409`

**Verify:** `npm run test:unit -w server -- src/services/enqueue-invoice.test.ts src/services/upload-invoice.test.ts src/services/retry.test.ts`

### Phase 4: Інтеграційні контракти і живий опис

- [ ] Переписати інтеграційні тести, які вимагають `503` і відкату рядка
- [ ] `make verify`
- [ ] Оновити `docs/architecture.md` під фактичний код. Фічу 001 не переписувати

**Verify:** `make verify`

## Dependencies

- Локальні Postgres і Redpanda для `make verify` (їх піднімає інтеграційний harness через `docker compose`).
- Юніт-тести цієї фічі від брокерів не залежать.

## Risks

- Щасливий шлях опублікує двічі, якщо drain і ще один шар обидва кличуть `publish`. Інтеграційний retry очікує рівно одне завдання. Публікує лише relay після commit.
- Добір `uploaded` без outbox під час уже опублікованого, але ще не спожитого рядка не спрацьовує: outbox уже існує. Дубль можливий лише для старих рядків без outbox; consumer це переживає.
- Якщо `send` пройшов, а позначка ні, наступний drain шле повтор. Це прийнятий at-least-once, не втрата.

## Estimate

- **Total:** один сеанс реалізації
- **Confidence:** High
