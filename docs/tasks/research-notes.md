# Research notes for the invoice tasks

**Checked:** 2026-10-21  
**Authority:** [docs/specs/001-invoice-processing-system.md](../specs/001-invoice-processing-system.md) is the contract. [docs/plans/001-invoice-processing-system.md](../plans/001-invoice-processing-system.md) already sequenced the work. These notes confirm that plan and record the practices the stories lock in. They do not add a service, a table, an endpoint, or a fourth agent tool.

The Ukrainian translation is [research-notes.uk.md](research-notes.uk.md).

## 1. Gemini models

Sources:

- [Gemini API deprecations](https://ai.google.dev/gemini-api/docs/deprecations), read 2026-10-21. `text-embedding-004` shutdown date is 14 January 2026. Replacement named on that page: `gemini-embedding-2`. `gemini-2.5-flash` has no Developer API shutdown date. The same page limits 2.5 access to keys that have already used those models, and tells new projects to start on `gemini-3.5-flash-lite` or `gemini-3.8-flash`.
- [Gemini API models](https://ai.google.dev/gemini-api/docs/models), same access note.
- [Vertex model lifecycle](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions). Vertex retires `gemini-2.5-flash` on 20 October 2026. That page does not govern this repo. The spec calls the Developer API with `GEMINI_API_KEY`.
- [Release notes](https://ai.google.dev/gemini-api/docs/changelog). 14 January 2026 entry: `text-embedding-004` shut down.

Locked:

- Extraction and the assistant use `gemini-2.5-flash` unless `GEMINI_MODEL` is set.
- The only substitute id is `gemini-3.8-flash`, and only by that env var. Google also names `gemini-3.5-flash-lite` for new projects. This feature does not add that id.
- A failed live call does not retry on another model. The invoice becomes `failed` with the provider error, or chat emits `error`.
- Do not call Vertex.

## 2. Embeddings

Source: [Embeddings](https://ai.google.dev/gemini-api/docs/embeddings), read 2026-10-21. Confirmed by the [Google Developers Blog post on Gemini Embedding 2](https://developers.googleblog.com/en/building-with-gemini-embedding-2/).

What the page says, and what the stories do:

| Page | Story rule |
|---|---|
| `task_type` is not accepted by `gemini-embedding-2`. Prefix the text. | Query: `task: question answering \| query: {user query}`. Document: `title: {title} \| text: {chunk}`. Missing title is `none`. |
| Question-answering is the asymmetric pair for questions against passages. | Use that pair. The assistant asks questions. Do not use `sentence similarity`. |
| Default size is 3072. `output_dimensionality: 768` is a documented recommended size. Truncated vectors are renormalized by the model. | Pass 768. Do not L2-normalize again in application code. Reject a vector whose length is not 768. The column stays `vector(768)`. |
| A list of raw inputs returns one aggregated vector. Separate vectors require one `Content` per input, or the Batch API. | Still one chunk per request. Do not pass the chunk array. Do not switch to the `Content` batch form in this feature. |

`chunk_content` stores the chunk without the prefix.

## 3. Structured extraction

Sources:

- [Structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), read 2026-10-21. Nullable JSON Schema is `"type": ["string", "null"]`. `gemini-2.5-flash` and `gemini-3.8-flash` are both listed for structured output.
- [Prism issue on `response_schema` vs `response_json_schema`](https://github.com/prism-php/prism/issues/974). The protobuf `response_schema` field returns HTTP 400 for a nullable type array and for nested `additionalProperties`. `response_json_schema` accepts both. The plan already requires `responseJsonSchema`.
- [Thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking). On `gemini-2.5-flash`, `thinkingBudget: 0` disables thinking. The default is dynamic thinking, which spends the AS-001 time budget before any JSON is returned. Gemini 3 and Gemini 4 want `thinkingLevel`. Sending `thinkingBudget` to those models can 400. The plan's rule covers that: one repeat of the same request without `thinkingConfig`, then fail. Do not add a `thinkingLevel` branch.
- [@google/genai 2.30.0](https://www.npmjs.com/package/@google/genai), released 14 October 2026. The package warns that 3.0.0 removes fields. Stay on 2.x (`2.30.0` or a newer 2.x if one exists when the story is implemented). Do not install `@google/generative-ai`.
- [Document processing](https://ai.google.dev/gemini-api/docs/generate-content/document-processing) and the plan's file-input note. Inline PDF on the Developer API is the one-shot path. The app cap is 20 MB, under the 50 MB inline PDF limit. Do not upload the invoice to the Gemini File API.

Practices the extractor story locks:

- Temperature 0.
- Send JSON Schema, then parse `response.text` with the same Zod schema. Provider enforcement is not the test.
- If `zod-to-json-schema` emits `anyOf` for nullables, rewrite those nodes to `"type": ["string", "null"]` before the request. A unit test locks that shape.
- The prompt treats file bytes as data, not as instructions. It transcribes printed amounts. It does not invent a total by adding lines. Nullable fields stay null when the page is silent. Dates are `YYYY-MM-DD` only when the order is unambiguous.
- A line-total mismatch does not fail the invoice and does not add columns. The [note on deterministic finance output](https://www.inspireailab.com/blog/deterministic-llm-output-finance-tax) is the reason the assistant sums with SQL. Record the mismatch gap in the README, as the plan already does.

## 4. LangGraph v1

Sources:

- [LangGraph v1 migration](https://docs.langchain.com/oss/javascript/migrate/langgraph-v1). `createReactAgent` is deprecated. `createAgent` lives in `langchain`. Node 18 is dropped. Node 22 or newer is required.
- [LangChain v1 migration](https://docs.langchain.com/oss/javascript/migrate/langchain-v1). The prompt argument is `systemPrompt`.
- [Persistence](https://docs.langchain.com/oss/javascript/langgraph/add-memory). `PostgresSaver.fromConnString`, then `setup()` once before use. The plan runs `setup()` at boot. Checkpoint tables are not handwritten in `init.sql`.
- [langgraphjs #1808](https://github.com/langchain-ai/langgraphjs/issues/1808) and [PR #2566](https://github.com/langchain-ai/langgraphjs/pull/2566), merged 22 June 2026. `createAgent` plus `PostgresSaver` threw on circular JSON and on a missing `versions_seen` during resume. The fix adds `BaseCheckpointSaver.toJSON()` and defaults those maps to `{}`. Install a `@langchain/langgraph-checkpoint-postgres` release that contains that fix. 1.1.0, published 12 October 2026, is the current line beside `@langchain/langgraph` 1.5.1 (16 October 2026).
- [Event streaming](https://docs.langchain.com/oss/javascript/langchain/event-streaming). `streamEvents(..., { version: "v3" })` exposes message and tool-call projections. Map those onto the plan's own SSE names (`meta`, `token`, `tool_start`, `tool_end`, `done`, `error`). Do not send LangChain's raw event stream to the browser.
- [Forum note on `recursionLimit`](https://forum.langchain.com/t/what-does-recursionlimit-actually-count-in-createagent-langchain-js/3460). The limit counts LangGraph supersteps, not tool calls. One model turn plus one tool round is about two supersteps. The plan's limit of 12 stays. A `GraphRecursionError` becomes a chat `error` event, not a silent retry.

Human confirmation before a write tool is a common agent pattern. This spec does not use it. `retry_failed_invoice` runs when the model calls it. The UI shows the pill after the fact.

## 5. KafkaJS and Redpanda

Sources:

- [kafkajs on npm](https://www.npmjs.com/package/kafkajs). Latest is 2.2.4, published 27 February 2023. No later stable release as of 21 October 2026.
- [KafkaJS #1753](https://github.com/tulios/kafkajs/issues/1753), still open. Maintainers describe the project as maintenance mode. Commenters discuss Confluent's client and `@platformatic/kafka`. Confluent's Node client is native. Platformatic's client had a Redpanda `SyncGroup` v4 bug, fixed in March 2026 ([platformatic/kafka #51](https://github.com/platformatic/kafka/issues/51)). The plan still chooses KafkaJS: pure JavaScript, no build step, and it speaks the API this Redpanda exposes. Do not switch clients inside these stories.
- [Redpanda Kafka clients](https://docs.redpanda.com/streaming/current/develop/kafka-clients/), page modified 17 September 2026. KafkaJS is still in Redpanda's validated Node.js client list.
- [Consuming](https://kafka.js.org/docs/consuming). `sessionTimeout` default 30000, `heartbeatInterval` default 3000 and must be lower than the session timeout.
- [KafkaJS #1396](https://github.com/tulios/kafkajs/issues/1396). The maintainer's position: a heartbeat that continues while the handler is stuck hides a dead consumer. The plan still requires `heartbeat()` during the Gemini call, on an interval shorter than `heartbeatInterval`, because a 5–20 second inference would otherwise exceed a 45 second session and be redelivered forever. Keep `sessionTimeout` on the order of 45 seconds. Do not raise it to minutes. The process crashing still stops the heartbeats, so a dead process is still detected. Call the handler's `heartbeat`, which KafkaJS treats as a no-op until the interval has elapsed ([#156](https://github.com/tulios/kafkajs/issues/156)).
- [KafkaJS #1764](https://github.com/tulios/kafkajs/issues/1764). Parallel `eachBatch` plus a detached heartbeat loop produced duplicates and rebalances. Process one message at a time. `autoCommit: false`. Commit the offset only after the database transaction that stored `completed` or `failed` has committed.

Copy the Redpanda service from spec §6, including image `docker.redpanda.com/redpandadata/redpanda:v24.1.1` and the `OUTSIDE://localhost:9092` advertised address. The host process connects to `localhost:9092`. If that image will not pull, stop. The only allowed image change is a newer `redpandadata/redpanda` tag with the same ports and the same advertised address. If the `rpk cluster health` check never passes, the only allowed change is the healthcheck command.

## 6. pgvector

Sources:

- [pgvector](https://github.com/pgvector/pgvector).
- [EDB pgvector indexing](https://www.enterprisedb.com/docs/pg_extensions/pgvector/using). Under about a million rows, a sequential scan is often faster than HNSW and is exact.
- [pgvector troubleshooting](https://pgvector.app/troubleshooting/). `ORDER BY embedding <=> $1 LIMIT n` can use a `vector_cosine_ops` index. `ORDER BY 1 - (embedding <=> $1) DESC` cannot. On a small table the planner may seq-scan anyway. Zero vectors are not indexed for cosine distance.

Locked:

- The HNSW index stays `m = 16`, `ef_construction = 64`, `vector_cosine_ops`.
- Select similarity as `1 - (embedding <=> $1)`. Order by the distance operator, ascending, with `LIMIT`.
- Tests assert neighbor order, not the `EXPLAIN` node.
- The fake embedder returns a non-zero unit-length 768-d vector. A zero vector would be invisible to the cosine index.

## 7. Upload handling

Sources:

- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html). Allowlist the types, do not trust `Content-Type`, generate the stored name, cap the size, keep the directory outside any static file middleware.
- [Unrestricted upload in Express](https://softwaresecurity.com/fix/file-upload/node-express/). `file.mimetype` is whatever the client wrote. `limits.fileSize` defaults to unlimited. Do not mount multer globally. Since multer 2.3.0 a file of exactly `limits.fileSize` is accepted; earlier 2.x rejected equality. The application check is the authority: byte length `<= 20 * 1024 * 1024` is accepted, one byte over is 413.
- Magic-byte notes from the same write-up and from [magic-number checks](https://transloadit.com/devtips/secure-api-file-uploads-with-magic-numbers/). A signature is not a malware verdict. This assignment needs the signature plus a generated name plus path confinement. It does not add antivirus or an image re-encoder.

Signatures the validator accepts:

| Declared type | Signature |
|---|---|
| `application/pdf` | bytes start with `%PDF` |
| `image/png` | `89 50 4E 47 0D 0A 1A 0A` |
| `image/jpeg` | `FF D8 FF` |

`image/jpg` is not accepted. The stored object is `<uuid>.<ext>` with the extension of the detected type (`.pdf`, `.png`, `.jpg`). `original_name` is the base name only. The value that is stored and rendered contains neither `/` nor `\`.

Use multer 2.x. Hold the upload in memory until the signature check passes, then write the file. A rejected upload leaves no row and no file. Multer is mounted on `POST /api/invoices/upload` only.

Encrypted PDFs are detected in the worker by the ASCII marker `/Encrypt` before any Gemini call. That is a byte scan, not a PDF parser that executes document JavaScript. The `error_message` says the file is encrypted. A file that does not match a signature, or that the worker cannot read, is `failed` with a message that says it is unreadable. The upload route has already rejected a bad signature, so the worker's unreadable path is for bytes that passed the signature and are still truncated or otherwise unusable.

## 8. Server-Sent Events and the Vite proxy

Sources:

- [WHATWG server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html). `EventSource` is GET. Reconnect is built in. A line starting with `:` is a comment and is the usual heartbeat.
- [Vite discussion #10851](https://github.com/vitejs/vite/discussions/10851). Proxied SSE often arrives as one chunk at the end until the response sets `X-Accel-Buffering: no`.
- [Vite server.proxy](https://vite.dev/config/server-options). `configure` on the proxy is the supported hook. Projects that still see buffering set `selfHandleResponse: true` and write each upstream chunk through.

Locked:

- Invoice stream: `GET /api/events/invoices`, browser `EventSource`.
- Chat stream: `POST /api/chat`, `fetch`, read the body. Do not use `EventSource` for chat.
- Response headers on both streams: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
- A comment line every 15 seconds (`: ping`).
- No server replay log. On connect and on reconnect the client loads `GET /api/invoices`, then applies an SSE event only when its `updatedAt` is newer than the row it has. Ignore `Last-Event-ID`.
- Vite proxies `/api` to port 3001. The browser calls `/api/...`. If a Playwright test shows tokens only after `done`, fix the proxy flush. Do not change the event names.

## 9. Hybrid retrieval

The plan's finance note matches the current guidance: a JSON schema guarantees shape, not that the printed total was read correctly, and an LLM is the wrong calculator for counts and sums. The three tools stay:

- `get_invoice_statistics_and_list` — one fixed SQL statement, bound parameters, no SQL string from the model.
- `search_invoices_vector` — cosine search over chunks.
- `retry_failed_invoice` — the same retry function as the HTTP route.

There is no bulk-retry tool. The model retries many rows by calling the tool once per id after the statistics tool lists them. `limit` on vector search defaults to 5 and caps at 10.

Vendor filter: escape `%`, `_`, and `\` before the `ILIKE` pattern. Match `extracted_data.vendor.name`. A non-numeric `totalAmount` is skipped. `total_sum` mixes currencies because the approved query has no currency grouping. That limitation goes in the README. Do not add a grouping tool.

## 10. Versions to install

Record the resolved versions in the lockfile when US-001 and the later stories install them.

| Package | Pin | Why |
|---|---|---|
| Node | `>=22`, `.nvmrc` = `22` | LangGraph v1 dropped Node 18. |
| `kafkajs` | `2.2.4` exact | Last release. Plan's client. |
| `@google/genai` | `2.30.0`, or the newest 2.x below 3.0.0 | 3.0.0 removes APIs. Do not use the legacy SDK. |
| `langchain`, `@langchain/langgraph` | current 1.x that exports `createAgent` | v1 API. 1.5.1 was current for langgraph on 16 October 2026. |
| `@langchain/langgraph-checkpoint-postgres` | 1.x that contains PR 2566 | `createAgent` + `PostgresSaver` resume bug. 1.1.0 was current on 12 October 2026. |
| `zod` | one major, whichever `langchain@1.5` already accepts (`^3.25.32` or `^4.2.0`) | Two majors in one package will break the tool schemas. |
| `multer` | 2.x | Plan. Not 1.x. |
| `pg` | current 8.x | Pool for SQL and the usual peer of `PostgresSaver`. No ORM. |
| React | 18 or 19 | Spec. Vite, Tailwind, Lucide, React Router. |
| Playwright | current 1.x | Browser proof for CP-4, CP-5, CP-8. |
| Vitest | 5.x (`5.0.5` or newer) | **Assumption:** unit and integration runner. The plan names npm scripts, not the runner. 3.2 and 4.1.x are inside the tinypool and `@vitest/mocker` advisories; 5.0.5 is the fixed release. |
| `pdf-lib` | current | Sample invoice generator. Not a PDF parser on the upload path. |

## What this research does not change

Authentication, a fixture mode on the product server, object storage, a second worker, extra topics, extra tools, Tesseract, `vector(768)`, the HNSW parameters, the status enum, currency conversion, an approval step before retry, email, and any edit to the spec or to `.cursor/rules/sdlc/`.
