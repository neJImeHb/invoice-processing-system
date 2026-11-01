import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { insertOutbox } from "../db/outbox.js";
import type { ProcessInvoiceEvent } from "../domain/invoice-event.js";
import { drainOutbox, startOutboxRelay } from "./outbox-relay.js";

const INVOICE_A = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const INVOICE_B = "8c2e0c0a-4b1e-4f0a-9a1c-6d5e4f3a2b10";
const OUTBOX_A = "11111111-1111-4111-8111-111111111111";
const OUTBOX_B = "22222222-2222-4222-8222-222222222222";
const FILE_PATH = "C:/uploads/a.pdf";
const MIME = "application/pdf";

interface InvoiceRow { readonly id: string; readonly filePath: string; readonly mimeType: string; readonly status: string }
interface OutboxRow { id: string; invoiceId: string; payload: unknown; published: boolean; createdAt: number }
interface Memory { invoices: InvoiceRow[]; outbox: OutboxRow[]; sequence: number; pending: OutboxRow[] | null; trace: string[] }
interface Rows { readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number }
interface Relay { drain(): Promise<void>; stop(): void }
function createMemoryPool(): { readonly pool: Pool; readonly memory: Memory } {
  const memory: Memory = { invoices: [], outbox: [], sequence: 0, pending: null, trace: [] };
  const query = (sql: string, params?: readonly unknown[]): Promise<Rows> => Promise.resolve(runSql(memory, sql, params ?? []));
  const client = { query, release(): void { return undefined; } };
  const pool = { query, connect: (): Promise<typeof client> => Promise.resolve(client) };
  return { memory, pool: pool as unknown as Pool };
}
function runSql(memory: Memory, sql: string, params: readonly unknown[]): Rows {
  if (sql === "BEGIN") { memory.pending = []; return empty(); }
  if (sql === "COMMIT") { memory.outbox.push(...(memory.pending ?? [])); memory.pending = null; return empty(); }
  if (sql === "ROLLBACK") { memory.pending = null; return empty(); }
  if (sql.includes("INSERT INTO invoice_outbox")) return remember(memory, params);
  if (sql.includes("NOT EXISTS")) return empty(missingRows(memory));
  if (sql.includes("ORDER BY created_at ASC, id ASC")) return empty(listRows(memory));
  if (sql.includes("SET published_at = NOW()")) { flagPublished(memory, params); return empty(); }
  throw new Error(`No handler for SQL: ${sql}`);
}
function empty(rows: readonly Record<string, unknown>[] = []): Rows {
  return { rows, rowCount: rows.length };
}
function remember(memory: Memory, params: readonly unknown[]): Rows {
  memory.sequence += 1;
  const row: OutboxRow = { id: text(params, 0), invoiceId: text(params, 1), payload: JSON.parse(text(params, 2)) as unknown, published: false, createdAt: memory.sequence };
  (memory.pending ?? memory.outbox).push(row);
  return empty();
}
function missingRows(memory: Memory): Record<string, unknown>[] {
  const ids = new Set([...memory.outbox, ...(memory.pending ?? [])].map((row) => row.invoiceId));
  return memory.invoices.filter((row) => row.status === "uploaded" && !ids.has(row.id)).map((row) => ({ id: row.id, file_path: row.filePath, mime_type: row.mimeType }));
}
function listRows(memory: Memory): Record<string, unknown>[] {
  return memory.outbox.filter((row) => !row.published).sort(byAge).map((row) => ({ id: row.id, invoice_id: row.invoiceId, payload: row.payload }));
}
function byAge(left: OutboxRow, right: OutboxRow): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}
function flagPublished(memory: Memory, params: readonly unknown[]): void {
  const row = memory.outbox.find((item) => item.id === text(params, 0) && !item.published);
  if (row === undefined) return;
  row.published = true;
  memory.trace.push(`mark:${row.id}`);
}
function text(params: readonly unknown[], index: number): string {
  const value = params[index];
  if (typeof value !== "string") throw new Error("expected string parameter");
  return value;
}
function job(eventId: string, invoiceId: string): ProcessInvoiceEvent {
  return { eventId, type: "PROCESS_INVOICE", invoiceId, filePath: FILE_PATH, mimeType: MIME, timestamp: "2026-10-21T10:00:00.000Z" };
}
function seed(memory: Memory, payload: ProcessInvoiceEvent): void {
  memory.sequence += 1;
  memory.outbox.push({ id: payload.eventId, invoiceId: payload.invoiceId, payload, published: false, createdAt: memory.sequence });
}
function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("backfill", () => {
  it("publishes one backfilled event and does not publish it again", async () => {
    const { pool, memory } = createMemoryPool();
    memory.invoices.push(
      { id: INVOICE_A, filePath: FILE_PATH, mimeType: MIME, status: "uploaded" },
      { id: INVOICE_B, filePath: "C:/uploads/b.pdf", mimeType: "image/png", status: "processing" },
    );
    const seen: ProcessInvoiceEvent[] = [];
    await drainOutbox(pool, {
      async publish(invoiceId: string, payload: ProcessInvoiceEvent): Promise<void> {
        expect(invoiceId).toBe(INVOICE_A);
        expect(memory.outbox.find((row) => row.id === payload.eventId)?.published).toBe(false);
        seen.push(payload);
      },
    });
    const created = memory.outbox[0];
    expect(created?.published).toBe(true);
    expect(seen[0]).toMatchObject({ eventId: created?.id, type: "PROCESS_INVOICE", invoiceId: INVOICE_A, filePath: FILE_PATH, mimeType: MIME });
    expect(seen[0]?.timestamp).toBe(new Date(seen[0]?.timestamp ?? "").toISOString());
    await drainOutbox(pool, { publish: () => Promise.reject(new Error("should not publish")) });
    expect(seen).toHaveLength(1);
    expect(memory.outbox).toHaveLength(1);
  });
});

describe("publish failure", () => {
  it("retries the same unpublished payload after publish rejects", async () => {
    const { pool, memory } = createMemoryPool();
    const payload = job(OUTBOX_A, INVOICE_A);
    memory.invoices.push({ id: INVOICE_A, filePath: FILE_PATH, mimeType: MIME, status: "uploaded" });
    seed(memory, payload);
    const seen: ProcessInvoiceEvent[] = [];
    let attempt = 0;
    const publisher = {
      async publish(_invoiceId: string, body: ProcessInvoiceEvent): Promise<void> {
        attempt += 1;
        if (attempt === 1) throw new Error("broker down");
        seen.push(body);
      },
    };
    await expect(drainOutbox(pool, publisher)).rejects.toThrow("broker down");
    expect(memory.outbox).toHaveLength(1);
    expect(memory.outbox[0]?.published).toBe(false);
    await drainOutbox(pool, publisher);
    expect(seen).toEqual([payload]);
    expect(memory.outbox[0]?.published).toBe(true);
  });
});

describe("overlap", () => {
  it("runs the queued pass after the in-flight pass marks the first row", async () => {
    const { pool, memory } = createMemoryPool();
    seed(memory, job(OUTBOX_A, INVOICE_A));
    const started = deferred();
    const hold = deferred();
    let calls = 0;
    const publisher = {
      async publish(_invoiceId: string, payload: ProcessInvoiceEvent): Promise<void> {
        calls += 1;
        memory.trace.push(`publish:${payload.eventId}`);
        if (calls === 1) {
          started.resolve();
          await hold.promise;
        }
      },
    };
    const drainA = drainOutbox(pool, publisher);
    try {
      await started.promise;
      const drainB = drainOutbox(pool, publisher);
      await Promise.resolve();
      expect(calls).toBe(1);
      seed(memory, job(OUTBOX_B, INVOICE_B));
      hold.resolve();
      await Promise.all([drainA, drainB]);
    } finally {
      hold.resolve();
    }
    expect(calls).toBe(2);
    expect(memory.trace).toEqual([`publish:${OUTBOX_A}`, `mark:${OUTBOX_A}`, `publish:${OUTBOX_B}`, `mark:${OUTBOX_B}`]);
    expect(memory.outbox.every((row) => row.published)).toBe(true);
  });
});

describe("rollback", () => {
  it("drops an insert that is rolled back", async () => {
    const { pool, memory } = createMemoryPool();
    const client = await pool.connect();
    await client.query("BEGIN");
    await insertOutbox(client, { id: OUTBOX_A, invoiceId: INVOICE_A, payload: job(OUTBOX_A, INVOICE_A) });
    await client.query("ROLLBACK");
    client.release();
    expect(memory.outbox).toHaveLength(0);
    expect(memory.pending).toBeNull();
  });
});

describe("startOutboxRelay", () => {
  it("resolves when the first drain fails and stop clears the interval", async () => {
    const { pool, memory } = createMemoryPool();
    seed(memory, job(OUTBOX_A, INVOICE_A));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cleared = vi.spyOn(globalThis, "clearInterval");
    let relay: Relay | undefined;
    try {
      relay = await startOutboxRelay(pool, { publish: () => Promise.reject(new Error("broker down")) });
      expect(logged).toHaveBeenCalled();
      expect(memory.outbox[0]?.published).toBe(false);
      await expect(relay.drain()).rejects.toThrow("broker down");
    } finally {
      relay?.stop();
      const stopCalled = cleared.mock.calls.length > 0;
      logged.mockRestore();
      cleared.mockRestore();
      expect(stopCalled).toBe(true);
    }
  });
});
