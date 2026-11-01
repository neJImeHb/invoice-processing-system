# Invoice Processing System

Upload a PDF or image invoice, watch it move through `uploaded → processing → completed / failed`, and ask an assistant about the results. The assistant can also queue a failed invoice again.

The browser talks to one Node process. That process stores the original file, then commits the invoice row and an outbox record in one Postgres transaction. A relay in the same process publishes the job to Redpanda and retries while the outbox row is still unpublished. A consumer in the same process extracts the invoice, stores a vector, and pushes status changes to every open tab over server-sent events. Closing the tab does not drop the job: the database, the outbox, and the topic still hold it. Reloading the page reads the current row, then the event stream catches up.

Counts, lists, and money totals come from SQL. The assistant is not asked to add numbers it saw in a paragraph. Semantic questions ("which invoice mentions cloud hosting?") use a vector search. A retry is a real status change and a new job, not a sentence about a retry.

## Prerequisites

- Docker Desktop
- Node.js 22 or newer (`nvm` can read `.nvmrc`)
- npm

On Windows, `npm run verify` is the same gate when `make` is not installed. `make verify` runs that script where `make` exists.

If port 5432 is already taken, stop the other Postgres before starting compose. The compose database listens on `localhost:5432`.

## Run the app

```bash
docker compose up -d --wait
copy .env.example .env
```

Put a Gemini API key in `GEMINI_API_KEY` when you want a live extract or a live chat. The UI and `npm run verify` do not need a key.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The API listens on port 3001. Vite proxies `/api` to it.

`.env.example` lists `GEMINI_API_KEY`, `DATABASE_URL`, `KAFKA_BROKERS`, `PORT`, and optional `GEMINI_MODEL`.

## Verify without a key

`npm run verify` typechecks, lints, and runs unit tests, integration tests, `test:integration:pipeline`, `test:integration:chat`, `test:integration:agent-actions`, `test:e2e:upload`, `test:e2e:retry`, and `test:e2e:chat`. It starts compose when the healthchecks are not already up. It does not call Google. Do not export `GEMINI_API_KEY` for this command.

`npm run live:invoice` is not part of that gate. With a key in `.env` and compose up:

```bash
npm run live:invoice -- server/fixtures/sample-invoice.pdf
```

The sample file is already in the repo. `npx tsx server/src/sample-invoice.ts` writes it again. The script prints the extracted JSON, the chunk count, and the elapsed milliseconds.

## Models

Chat and extraction use `gemini-2.5-flash`. If this API key cannot call that model, set one line in `.env`:

```bash
GEMINI_MODEL=gemini-3.8-flash
```

There is no automatic fallback. A failed call marks the invoice `failed` or refuses the chat with the provider error.

Embeddings use `gemini-embedding-2` with `outputDimensionality: 768`. The column is `vector(768)`. `text-embedding-004` is shut down, and the model's default 3072 dimensions would not fit the column.

## With more time

Most of the time went into forming a rough picture of the system in my head — the architecture — and then rewriting that picture into structured text, so a clear specification could be written from it. I read the specification through in detail. Every point that was still doubtful was changed or made explicit.

## How AI tools were used

AI did most of the writing of the code and the tests. I also used it to look up best practices and reviews. It took a direct part in shaping the architecture: it acted as an advisor and widened the picture of the architecture I already had.

## Layout

- `client/` — React UI
- `server/` — Express API, outbox relay, consumer, and assistant
- `docker-compose.yml` — Postgres 16 with pgvector, and Redpanda
- `docs/` — spec, plan, tasks, and research notes
