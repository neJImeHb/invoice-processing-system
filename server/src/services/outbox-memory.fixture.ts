import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { isInvoiceStatus, type InvoiceStatus } from "../db/invoices.js";

export interface StoredInvoice {
  id: string; filename: string; original_name: string; mime_type: string;
  file_size: number; file_path: string; status: InvoiceStatus; error_message: string | null;
  retry_count: number; extracted_data: unknown; normalized_text: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
}

export interface SqlCall { readonly sql: string; readonly params: readonly unknown[] }

interface OutboxRow { id: string; invoiceId: string; payload: unknown; published: boolean; createdAt: number }
interface PendingWork { inserted: StoredInvoice[]; updates: StoredInvoice[]; outbox: OutboxRow[] }
interface Rows { readonly rows: readonly object[]; readonly rowCount: number }

export interface OutboxMemory {
  invoices: StoredInvoice[]; outbox: OutboxRow[]; events: string[]; clients: SqlCall[][];
  failOutboxInsert: boolean; loseNextUpdate: boolean; sequence: number; pending: PendingWork | null;
}

export function createOutboxMemoryPool(): { readonly pool: Pool; readonly memory: OutboxMemory } {
  const memory: OutboxMemory = {
    invoices: [], outbox: [], events: [], clients: [],
    failOutboxInsert: false, loseNextUpdate: false, sequence: 0, pending: null,
  };
  const pool = {
    query(sql: string, params?: readonly unknown[]): Promise<Rows> {
      return record(memory, undefined, sql, params);
    },
    connect(): Promise<PoolClient> {
      const log: SqlCall[] = [];
      memory.clients.push(log);
      return Promise.resolve(boundClient(memory, log));
    },
  };
  return { memory, pool: pool as unknown as Pool };
}

function boundClient(memory: OutboxMemory, log: SqlCall[]): PoolClient {
  return {
    query(sql: string, params?: readonly unknown[]): Promise<Rows> {
      return record(memory, log, sql, params);
    },
    release(): void { return undefined; },
  } as unknown as PoolClient;
}

function record(memory: OutboxMemory, log: SqlCall[] | undefined, sql: string, params?: readonly unknown[]): Promise<Rows> {
  const call: SqlCall = { sql, params: params ?? [] };
  log?.push(call);
  memory.events.push(sql);
  try {
    return Promise.resolve(dispatch(memory, sql, call.params));
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error("query failed"));
  }
}

function dispatch(memory: OutboxMemory, sql: string, params: readonly unknown[]): Rows {
  if (sql === "BEGIN") {
    memory.pending = { inserted: [], updates: [], outbox: [] };
    return none();
  }
  if (sql === "COMMIT") return commitPending(memory);
  if (sql === "ROLLBACK") {
    memory.pending = null;
    return none();
  }
  if (sql.includes("INSERT INTO invoice_outbox")) return insertOutboxRow(memory, params);
  if (sql.includes("INSERT INTO invoices")) return insertInvoice(memory, params);
  if (sql.includes("UPDATE invoices")) return updateInvoice(memory, params);
  if (sql.includes("NOT EXISTS")) return none(missingRows(memory));
  if (sql.includes("ORDER BY created_at ASC, id ASC")) return none(unpublishedRows(memory));
  if (sql.includes("SET published_at = NOW()")) return markPublished(memory, params);
  if (sql.includes("FROM invoices WHERE id")) {
    const row = findInvoice(memory, requiredText(params, 0));
    return none(row === undefined ? [] : [row]);
  }
  throw new Error(`No handler for SQL: ${sql}`);
}

function commitPending(memory: OutboxMemory): Rows {
  const pending = memory.pending;
  if (pending === null) throw new Error("COMMIT without BEGIN");
  memory.invoices.push(...pending.inserted);
  for (const update of pending.updates) {
    const index = memory.invoices.findIndex((row) => row.id === update.id);
    if (index < 0) memory.invoices.push(update);
    else memory.invoices[index] = update;
  }
  memory.outbox.push(...pending.outbox);
  memory.pending = null;
  return none();
}

function insertInvoice(memory: OutboxMemory, params: readonly unknown[]): Rows {
  const now = new Date().toISOString();
  const row: StoredInvoice = {
    id: randomUUID(), filename: requiredText(params, 0), original_name: requiredText(params, 1),
    mime_type: requiredText(params, 2), file_size: requiredNumber(params, 3), file_path: requiredText(params, 4),
    status: "uploaded", error_message: null, retry_count: 0, extracted_data: null, normalized_text: null,
    created_at: now, updated_at: now, completed_at: null,
  };
  if (memory.pending === null) memory.invoices.push(row);
  else memory.pending.inserted.push(row);
  return none([row]);
}

function insertOutboxRow(memory: OutboxMemory, params: readonly unknown[]): Rows {
  if (memory.failOutboxInsert) throw new Error("outbox insert failed");
  memory.sequence += 1;
  const row: OutboxRow = {
    id: requiredText(params, 0), invoiceId: requiredText(params, 1), published: false, createdAt: memory.sequence,
    payload: JSON.parse(requiredText(params, 2)) as unknown,
  };
  if (memory.pending === null) memory.outbox.push(row);
  else memory.pending.outbox.push(row);
  return none();
}

function updateInvoice(memory: OutboxMemory, params: readonly unknown[]): Rows {
  const id = requiredText(params, 0);
  if (memory.loseNextUpdate) return loseUpdate(memory, id);
  const current = findInvoice(memory, id);
  if (current === undefined || current.status !== requiredText(params, 1)) return none();
  const pending = memory.pending;
  if (pending === null) throw new Error("UPDATE outside a transaction");
  const next: StoredInvoice = {
    ...current, status: requiredStatus(requiredText(params, 2)), error_message: requiredMessage(params[3]),
    retry_count: requiredNumber(params, 4), updated_at: new Date().toISOString(),
  };
  pending.updates = [...pending.updates.filter((row) => row.id !== id), next];
  return none([next]);
}

function loseUpdate(memory: OutboxMemory, id: string): Rows {
  memory.loseNextUpdate = false;
  const current = memory.invoices.find((row) => row.id === id);
  if (current !== undefined) {
    current.status = "processing";
    current.updated_at = new Date().toISOString();
  }
  return none();
}

function findInvoice(memory: OutboxMemory, id: string): StoredInvoice | undefined {
  return memory.pending?.updates.find((row) => row.id === id) ?? memory.invoices.find((row) => row.id === id);
}

function missingRows(memory: OutboxMemory): object[] {
  const ids = new Set(memory.outbox.map((row) => row.invoiceId));
  return memory.invoices.filter((row) => row.status === "uploaded" && !ids.has(row.id))
    .map((row) => ({ id: row.id, file_path: row.file_path, mime_type: row.mime_type }));
}

function unpublishedRows(memory: OutboxMemory): object[] {
  return memory.outbox.filter((row) => !row.published)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map((row) => ({ id: row.id, invoice_id: row.invoiceId, payload: row.payload }));
}

function markPublished(memory: OutboxMemory, params: readonly unknown[]): Rows {
  const row = memory.outbox.find((item) => item.id === requiredText(params, 0) && !item.published);
  if (row !== undefined) row.published = true;
  return none();
}

function none(rows: readonly object[] = []): Rows {
  return { rows, rowCount: rows.length };
}

function requiredText(params: readonly unknown[], index: number): string {
  const value = params[index];
  if (typeof value !== "string") throw new Error("expected string parameter");
  return value;
}

function requiredNumber(params: readonly unknown[], index: number): number {
  const value = params[index];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("expected number parameter");
  return value;
}

function requiredStatus(value: string): InvoiceStatus {
  if (!isInvoiceStatus(value)) throw new Error("expected invoice status");
  return value;
}

function requiredMessage(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  throw new Error("expected error message");
}
