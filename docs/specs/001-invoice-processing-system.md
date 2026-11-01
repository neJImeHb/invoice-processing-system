# Specification: Invoice Processing & AI Assistant System

**Document ID:** `SPEC-001`  
**Title:** Full-Stack Async Invoice Processing System with Kafka, pgvector, and LangGraph  
**Author:** AI Engineer & System Architect  
**Status:** Approved (Requirements Clarified)  
**Target Stack:** TypeScript (React 18+, Express), PostgreSQL 16+ (pgvector), Redpanda (Kafka API), Google Gemini (2.5 Flash & text-embedding-004), LangGraph (`@langchain/langgraph`)  
**Date:** 2026-10-21  

---

## 1. Executive Summary & Thesis

The system is a resilient, production-ready full-stack web application designed for asynchronous document (invoice) ingestion, automated information extraction, vectorization, and conversational AI assistance. 

Users can upload invoices as PDF documents or image files. The pipeline stores raw files immutably, delegates processing asynchronously through an event-driven Kafka/Redpanda message bus, utilizes Google Gemini multimodal models to extract structured JSON data and clean semantic text (free of OCR noise, abbreviations, and emojis), generates high-density embeddings, and stores them in PostgreSQL with `pgvector`. A LangGraph-powered conversational agent provides contextual search, structured analytical aggregation (totals, counts, status breakdowns), and autonomous action execution (triggering retries for failed documents).

---

## 2. Business & Technical Problem Statement

Traditional document processing workflows suffer from:
1. **Synchronous HTTP bottlenecks**: Ingestion fails or hangs if file parsing and LLM inference take 5–20 seconds, causing browser timeouts or orphaned jobs when users navigate away.
2. **Brittle status tracking**: Lack of persistent event state means clients lose track of jobs if disconnected.
3. **Loss of structural accuracy in pure RAG**: Standard text chunking loses tabular invoice data (vendor names, tax IDs, invoice numbers, line-item totals), while pure SQL databases cannot answer fuzzy or semantic questions.
4. **Passive AI**: Standard chatbots can answer questions but cannot execute remedial operational actions (e.g., retrying failed ingestion pipelines).

---

## 3. High-Level Architecture & Data Flow

```
                                      +---------------------------------------------+
                                      |                 REACT CLIENT                |
                                      |  Page 1: Invoices List & Upload Dashboard   |
                                      |  Page 2: AI Assistant Chat Interface        |
                                      +---------------------------------------------+
                                                 ▲                      │
                                       SSE Stream│(Real-Time Status)    │ REST / JSON
                                                 │                      ▼
                                      +---------------------------------------------+
                                      |             EXPRESS API GATEWAY             |
                                      |  - Multer File Receiver                     |
                                      |  - Status Event Broker (SSE)                |
                                      |  - LangGraph Agent Endpoint                 |
                                      +---------------------------------------------+
                                                 │                      │
                             Publish Ingest Event│                      │ Query & Actions
                                                 ▼                      ▼
+------------------------------------+   +---------------+   +----------------------+
|            LOCAL VOLUME            |   |   REDPANDA    |   |     POSTGRESQL 16    |
| - Raw immutable PDF & Image storage|   |  (Kafka API)  |   | - invoices (JSONB)   |
+------------------------------------+   |  Topic:       |   | - invoice_chunks     |
                                         |  invoice-jobs |   |   (pgvector 768d)    |
                                         +---------------+   | - langgraph_store    |
                                                 │           +----------------------+
                                  Consumer Worker│                      ▲
                                                 ▼                      │
                                      +----------------------+          │
                                      | ASYNC WORKER SERVICE |          │
                                      |  - Gemini 2.5 Flash  |──────────┘
                                      |    (Multimodal &     |  Persist Extracted
                                      |     Text Normalizer) |  JSONB + Embeddings
                                      |  - text-embedding-004|
                                      +----------------------+
```

### 3.1 Step-by-Step Document Lifecycle

1. **Upload & Persistence**:
   - The user selects or drags & drops a PDF or image (`.png`, `.jpg`, `.jpeg`).
   - Express server (`multer`) stores the original file without modification in the local uploads volume (`uploads/<uuid>.<ext>`).
   - Database record created in `invoices` table with status `uploaded`.
   - Real-time status update pushed to frontend via Server-Sent Events (SSE).

2. **Async Event Dispatch (Kafka / Redpanda)**:
   - Express publishes an event `INVOICE_UPLOADED` to the `invoice-processing-jobs` topic with payload `{ invoiceId, filePath, mimeType, originalName }`.
   - HTTP response returns immediately (`202 Accepted`) with `{ id, status: "uploaded" }`.
   - If the user closes the tab or loses internet connection, the job remains queued and persistent in Redpanda.

3. **Worker Consumption & Processing**:
   - The background worker consumes the event from Redpanda.
   - Worker immediately updates invoice status to `processing` in PostgreSQL and broadcasts the transition via SSE.
   - Worker loads the raw file buffer and sends it to **Google Gemini 2.5 Flash** with a strict prompt and JSON Schema:
     * **Structured Extraction**: Vendor details, invoice number, issue date, due date, line items (description, quantity, unit price, total), currency, subtotal, tax, grand total.
     * **Text Normalization**: Complete semantic representation where abbreviations are expanded (e.g., "т.д." -> "так далі", "ТОВ" -> "Товариство з обмеженою відповідальністю", "VAT" -> "Value Added Tax"), emojis and OCR artifacts are stripped, and tabular data is linearized into clean natural language sentences for optimal vector indexing.
   - Worker passes normalized chunks to **Google `text-embedding-004`** (768 dimensions).
   - Worker stores the structured data in `invoices.extracted_data` (JSONB) and vectors in `invoice_chunks` table (pgvector).
   - Worker updates invoice status to `completed` (with `completed_at` timestamp). SSE broadcasts `completed`.

4. **Failure & Retry Circuit**:
   - If parsing fails (corrupt file, rate limits, schema mismatch, model refusal), worker catches the error, sets status to `failed`, records `error_message`, and broadcasts via SSE.
   - User on Page 1 sees the `failed` badge with the error details and a "Retry" button.
   - User or AI Assistant on Page 2 can trigger a retry:
     * Endpoint `POST /api/invoices/:id/retry` resets status to `uploaded`, clears `error_message`, increments `retry_count`, and re-emits to Redpanda.

5. **AI Assistant & Hybrid Retrieval (LangGraph)**:
   - On Page 2, user converses with the AI assistant.
   - Agent is constructed using `@langchain/langgraph` with tool-calling capabilities (`gemini-2.5-flash`).
   - Agent has 3 core tools:
     1. `get_invoice_statistics_and_list`: Direct SQL execution for deterministic queries ("How many invoices?", "Show failed invoices", "What is the total sum across all approved invoices?").
     2. `search_invoices_vector`: Cosine similarity search in `pgvector` (`<=>` operator) for semantic content ("Which invoice mentions cloud hosting subscription or database licenses?").
     3. `retry_failed_invoice`: Action tool that accepts `invoiceId`, verifies it is `failed`, updates DB, republishes to Redpanda, and reports the action outcome to the user.

---

## 4. Detailed Component Specifications

### 4.1 Frontend Application (React + TypeScript)

The UI will be built as a Single-Page Application (SPA) with React 18/19, TypeScript, Vite, Tailwind CSS, and Lucide icons.

#### Page 1: Invoices Dashboard (`/` or `/invoices`)
- **Header**: Navigation bar to toggle between "Invoices" and "AI Assistant", with system health badge (PostgreSQL connected, Redpanda alive).
- **Upload Dropzone**:
  * Drag-and-drop area supporting PDF, PNG, JPG, JPEG (up to 20MB).
  * Immediate feedback with progress bar and transition to `uploaded`.
- **Invoices Table / Card List**:
  * Columns: File Preview/Icon, Filename, Upload Date, File Size, Status Badge, Extracted Summary (Total / Vendor), Actions.
  * Status Badges:
    - `uploaded`: Neutral/Yellow with subtle pulse.
    - `processing`: Blue with spinning progress indicator.
    - `completed`: Green with checkmark. Clicking opens Extracted Data Modal.
    - `failed`: Red with alert icon and tooltip showing error cause.
  * Actions per item:
    - **View Details**: Opens modal/drawer showing raw file preview + structured JSONB breakdown (line items table, tax, total, normalized text).
    - **Retry Button**: Enabled only when status is `failed`.
    - **Delete Button**: Confirmation dialog; permanently removes DB records, vector embeddings, and disk file.
- **Real-Time Client Architecture**:
  * Persistent `EventSource` connection to `/api/events/invoices`.
  * On receiving `INVOICE_STATUS_CHANGED`, dynamically updates React state without full page refresh.
  * Reconnection resilience: if connection drops, it reconnects automatically; on reconnection, it reconciles current state with `GET /api/invoices`.

#### Page 2: Conversational AI Assistant (`/chat`)
- **Chat Interface**:
  * Message timeline with user bubbles, AI responses, timestamps, and copy-to-clipboard.
  * Streaming text responses for low perceived latency.
  * **Tool Execution Badges**: When the agent calls a tool (e.g. `[Tool Executed: retry_failed_invoice(id="inv_481")]`), a collapsible UI pill displays the tool name, parameters, and execution result.
  * Suggested Prompts (Chips):
    - "Скільки всього завантажено інвойсів та які їхні статуси?"
    - "Яка загальна сума витрат за всіма завершеними рахунками?"
    - "Знайди інвойси, де є згадка про послуги розробки або ліцензії."
    - "Повтори обробку для всіх невдалих інвойсів."
- **Context Awareness**:
  * AI has access to real-time database state (it knows how many files exist and their current statuses even if changed seconds ago).

---

### 4.2 Backend API & Express Gateway

Built with Node.js, Express, and TypeScript (`tsx` / `esbuild`).

#### Endpoints Contract:

| Method | Endpoint | Description | Request Body / Params | Response |
|---|---|---|---|---|
| `POST` | `/api/invoices/upload` | Multipart upload for PDF/Image | `multipart/form-data` (`file`) | `202 Accepted` `{ id, filename, status: "uploaded" }` |
| `GET` | `/api/invoices` | List all invoices with metadata | Query params: `status`, `limit`, `offset` | `200 OK` `[{ id, original_name, status, extracted_data, ... }]` |
| `GET` | `/api/invoices/:id` | Get single invoice details | Route param `:id` | `200 OK` `{ invoice, chunksCount }` |
| `GET` | `/api/invoices/:id/file` | Download/view raw original file | Route param `:id` | `200 OK` (Binary stream with proper mime-type) |
| `POST` | `/api/invoices/:id/retry` | Trigger retry for failed invoice | Route param `:id` | `200 OK` `{ success: true, status: "uploaded" }` |
| `DELETE` | `/api/invoices/:id` | Delete invoice, vectors & file | Route param `:id` | `200 OK` `{ success: true }` |
| `GET` | `/api/events/invoices` | SSE real-time event stream | None | `text/event-stream` (Heartbeats + status events) |
| `POST` | `/api/chat` | Send message to LangGraph Agent | `{ message: string, threadId?: string }` | SSE or JSON response with message & tool calls |
| `GET` | `/api/health` | Service health check | None | `200 OK` `{ status: "ok", postgres: true, kafka: true }` |

---

### 4.3 Database Schema (PostgreSQL + pgvector)

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. Invoices Master Table
CREATE TYPE invoice_status AS ENUM ('uploaded', 'processing', 'completed', 'failed');

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    status invoice_status NOT NULL DEFAULT 'uploaded',
    error_message TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    extracted_data JSONB,
    normalized_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_created_at ON invoices(created_at DESC);
CREATE INDEX idx_invoices_extracted_data_gin ON invoices USING GIN (extracted_data);

-- 2. Invoice Chunks & Embeddings Table
CREATE TABLE invoice_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    chunk_content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(768) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_chunks_invoice_id ON invoice_chunks(invoice_id);

-- HNSW Vector Index for sub-millisecond approximate nearest neighbor search
CREATE INDEX idx_invoice_chunks_embedding_hnsw 
ON invoice_chunks 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 3. LangGraph Checkpoints (if using PostgresSaver)
-- Managed automatically by @langchain/langgraph-checkpoint-postgres
```

---

### 4.4 Event Streaming (Redpanda / Kafka Architecture)

- **Engine:** Redpanda in `docker-compose.yml` (zero JVM overhead, single binary, Kafka API v2/v3 compatible, instantaneous boot).
- **Topics:**
  * `invoice-jobs`: Partitions: 3, Replication factor: 1.
    - Key: `invoiceId` (ensures ordered processing per invoice).
    - Payload:
      ```json
      {
        "eventId": "evt_uuid",
        "type": "PROCESS_INVOICE",
        "invoiceId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "filePath": "uploads/f47ac10b.pdf",
        "mimeType": "application/pdf",
        "timestamp": "2026-10-21T10:00:00Z"
      }
      ```
- **Consumer Group:** `invoice-processing-workers`.
- **Fault Tolerance:**
  * Auto-commit after successful database transaction.
  * If the worker crashes mid-inference, the unacknowledged message will be re-delivered to the worker upon restart.

---

### 4.5 AI Processing & Extraction Pipeline (Gemini Multimodal & Vectorizer)

#### Prompt & Extraction Strategy:
Gemini 2.5 Flash is invoked with the raw file payload (`inlineData` or File API) and a structured extraction contract.

```typescript
// Zod Schema for Structured Extraction
import { z } from "zod";

export const InvoiceExtractionSchema = z.object({
  invoiceNumber: z.string().nullable().describe("Official invoice or bill number"),
  vendor: z.object({
    name: z.string().describe("Legal or trading name of the seller/supplier"),
    taxId: z.string().nullable().describe("Tax ID / VAT / USREOU / EIN if present"),
    address: z.string().nullable()
  }),
  customer: z.object({
    name: z.string().nullable().describe("Recipient / buyer name"),
    taxId: z.string().nullable()
  }),
  dates: z.object({
    issueDate: z.string().nullable().describe("Date invoice was issued (ISO 8601 YYYY-MM-DD if possible)"),
    dueDate: z.string().nullable().describe("Payment due date")
  }),
  financials: z.object({
    currency: z.string().default("USD").describe("ISO 3-letter currency code, e.g. USD, EUR, UAH"),
    subtotal: z.number().nullable(),
    taxAmount: z.number().nullable(),
    totalAmount: z.number().describe("Final grand total amount to pay")
  }),
  lineItems: z.array(z.object({
    description: z.string().describe("Description of product or service"),
    quantity: z.number().default(1),
    unitPrice: z.number().nullable(),
    totalPrice: z.number().describe("Line item total price")
  })).default([]),
  normalizedText: z.string().describe(
    "Comprehensive, fully expanded clean plain-text summary of the entire document. " +
    "MANDATORY: Expand all abbreviations (e.g. 'т.д.' -> 'так далі', 'ТОВ' -> 'Товариство з обмеженою відповідальністю', 'Inc.' -> 'Incorporated', 'qty' -> 'quantity'). " +
    "Remove all emojis, decorative symbols, OCR noise, watermarks. Format as structured clean sentences suitable for semantic vector retrieval."
  )
});
```

#### Vectorization:
1. `normalizedText` is partitioned into semantic chunks (chunk size ~500 tokens, overlap ~50 tokens). For standard 1-2 page invoices, 1-3 chunks are generated.
2. Each chunk is embedded using Google's `text-embedding-004` API (768 dimensions).
3. Chunks and embeddings are inserted into `invoice_chunks` with `invoice_id` and metadata (`vendor`, `invoiceNumber`, `totalAmount`, `date`).

---

### 4.6 LangGraph Conversational Agent Architecture

The AI Assistant is constructed as a LangGraph state machine.

```
                  +--------------------------------+
                  |         START NODE             |
                  +--------------------------------+
                                   │
                                   ▼
                  +--------------------------------+
                  |         AGENT NODE             |
                  |  Gemini 2.5 Flash with Tools   |
                  +--------------------------------+
                                   │
                     ┌─────────────┴─────────────┐
                     │ Tool Call Required        │ Direct Response
                     ▼                           ▼
      +-----------------------------+    +---------------+
      |         TOOL NODE           |    |   END NODE    |
      | - search_invoices_vector    |    +---------------+
      | - get_invoice_stats_and_list|
      | - retry_failed_invoice      |
      +-----------------------------+
                     │
                     └─────────────► Return Tool Output to Agent
```

#### Defined Agent Tools:

1. **`get_invoice_statistics_and_list`**:
   - **Purpose**: Solves counting, status listing, and exact mathematical queries without hallucination.
   - **Parameters**: `status?: "uploaded" | "processing" | "completed" | "failed" | "all"`, `vendor?: string`.
   - **Action**: Queries PostgreSQL `invoices` table directly:
     ```sql
     SELECT 
       COUNT(*) as total_count,
       COUNT(*) FILTER (WHERE status = 'uploaded') as uploaded_count,
       COUNT(*) FILTER (WHERE status = 'processing') as processing_count,
       COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
       COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
       COALESCE(SUM((extracted_data->'financials'->>'totalAmount')::numeric), 0) as total_sum
     FROM invoices;
     ```
   - **Return**: Precise counts, financial totals, and recent list of files.

2. **`search_invoices_vector`**:
   - **Purpose**: Semantic and fuzzy document content discovery.
   - **Parameters**: `query: string`, `limit?: number`.
   - **Action**: Generates embedding for `query` via `text-embedding-004`, queries `invoice_chunks` using `<=>` (cosine distance) joined with `invoices` metadata.
   - **Return**: Ranked relevant text passages, file names, matching line items, and similarity scores.

3. **`retry_failed_invoice`**:
   - **Purpose**: Autonomous remediation action.
   - **Parameters**: `invoiceId: string` (or filename resolution).
   - **Action**:
     - Checks if invoice exists and its current status is `failed`.
     - Updates status to `uploaded`, clears `error_message`, increments `retry_count`.
     - Produces event to Redpanda `invoice-jobs`.
     - Broadcasts update via SSE.
   - **Return**: Success message confirming the invoice has been re-queued for processing.

---

## 5. Acceptance Scenarios & Test Plan

### AS-001: File Ingestion & Real-Time Status Lifecycle
- **WHEN**: User uploads a valid PDF invoice `sample-invoice.pdf` on Page 1.
- **THEN**: The file is stored in `uploads/`, record created with status `uploaded`, Kafka event emitted, status transitions to `processing`, Gemini extracts data, embeddings saved to `pgvector`, and status transitions to `completed` in under 15 seconds without manual page refresh.
- **IF**: Network disconnects while processing, **THEN** job completes in background and reloading Page 1 displays `completed` with full extracted data.
- **Verify**: `npm run test:e2e:upload`

### AS-002: Error Handling & Retry Mechanism
- **WHEN**: An invalid, password-protected, or corrupted PDF is uploaded.
- **THEN**: The worker catches the failure, transitions status to `failed`, stores specific `error_message`, and UI displays the failed badge with a "Retry" button.
- **WHEN**: User clicks "Retry" (or asks AI to retry),
- **THEN**: Status resets to `uploaded`, event re-emits to Redpanda, and worker re-attempts processing.
- **Verify**: `npm run test:e2e:retry`

### AS-003: AI Assistant Quantitative & Qualitative Answers
- **WHEN**: User asks "Скільки всього завантажено інвойсів і скільки з них успішно оброблено?"
- **THEN**: Agent invokes `get_invoice_statistics_and_list`, accurately answers with exact numbers from PostgreSQL, and does not hallucinate counts.
- **WHEN**: User asks "Знайди рахунок за підписку на хмарний сервер і скажи суму",
- **THEN**: Agent invokes `search_invoices_vector`, retrieves matching chunk from `pgvector`, and cites the exact invoice filename, vendor, and amount.
- **Verify**: `npm run test:integration:chat`

### AS-004: AI Assistant Action Execution
- **WHEN**: User prompts "Зроби retry для інвойсу, який завершився з помилкою".
- **THEN**: Agent identifies the failed invoice ID, calls `retry_failed_invoice(invoiceId)`, the database status updates to `uploaded`, Redpanda receives the job, and the UI immediately reflects the transition.
- **Verify**: `npm run test:integration:agent-actions`

---

## 6. Docker & Local Development Setup

A single `docker-compose.yml` ensures anyone grading the assignment can launch the entire infrastructure with a single command:

```yaml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: invoice_postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgrespassword
      POSTGRES_DB: invoice_db
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./server/src/db/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d invoice_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  redpanda:
    image: docker.redpanda.com/redpandadata/redpanda:v24.1.1
    container_name: invoice_redpanda
    command:
      - redpanda start
      - --smp 1
      - --memory 512M
      - --reserve-memory 0M
      - --overprovisioned
      - --node-id 0
      - --kafka-addr PLAINTEXT://0.0.0.0:29092,OUTSIDE://0.0.0.0:9092
      - --advertise-kafka-addr PLAINTEXT://redpanda:29092,OUTSIDE://localhost:9092
    ports:
      - "9092:9092"
      - "9644:9644"
    healthcheck:
      test: ["CMD-SHELL", "rpk cluster health | grep -q 'Healthy:.*true'"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

---

## 7. Project Directory Structure

```
.
├── docker-compose.yml              # PostgreSQL (pgvector) + Redpanda
├── Makefile                        # verify, up, down, test commands
├── package.json                    # Workspace root
├── docs/
│   └── specs/
│       └── 001-invoice-processing-system.md  # THIS SPECIFICATION
├── client/                         # React Frontend (Vite + TypeScript + Tailwind)
│   ├── src/
│   │   ├── api/                    # REST client & SSE EventSource hooks
│   │   ├── components/             # InvoicesTable, UploadDropzone, ChatBox, InvoiceModal
│   │   ├── pages/
│   │   │   ├── InvoicesPage.tsx    # Page 1: Dashboard with live status updates
│   │   │   └── ChatPage.tsx        # Page 2: LangGraph conversational agent
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── package.json
└── server/                         # Express Backend & LangGraph Agent
    ├── src/
    │   ├── config/                 # Env validation (GEMINI_API_KEY, DB_URL, KAFKA_BROKERS)
    │   ├── db/                     # PostgreSQL pool, migrations, pgvector queries
    │   ├── kafka/                  # Redpanda producer, consumer worker
    │   ├── services/
    │   │   ├── gemini.ts           # Gemini 2.5 Flash extractor & text-embedding-004
    │   │   ├── sse.ts              # Real-time Server-Sent Events hub
    │   │   └── storage.ts          # Local file storage manager
    │   ├── agent/                  # LangGraph state graph, tools, and checkpointing
    │   │   ├── tools/              # get_stats, search_vector, retry_invoice
    │   │   └── graph.ts            # LangGraph workflow compiled runnable
    │   ├── routes/                 # Express REST endpoints
    │   └── index.ts                # Express server entry point
    └── package.json
```

---

## 8. Risk Management & Constraints

| Risk | Mitigation |
|---|---|
| Large PDF extraction latency / token exhaustion | Gemini 2.5 Flash native multimodal input supports up to 1M tokens context and handles multi-page PDFs directly without external OCR dependencies (Tesseract). |
| Disconnected client during processing | Processing is decoupled into Kafka/Redpanda. Database state is ground truth. On page reload, React fetches current DB status, then reconnects to SSE. |
| Inaccurate aggregations from LLM (e.g. summing numbers) | LangGraph agent uses the deterministic `get_invoice_statistics_and_list` tool (SQL aggregates) rather than trying to sum numbers from retrieved vector chunks. |
| Vector search noise from abbreviations and emojis | Gemini extraction prompt strictly commands text normalization: expanding all abbreviations into full natural words and stripping emojis/symbols prior to vectorization. |
| Reviewer system resource limits | Redpanda consumes ~150MB RAM compared to ~1.5GB for Apache Kafka + Zookeeper, boots in ~1 second, and requires zero Java runtime. |
