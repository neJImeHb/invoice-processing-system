import { describe, expect, it } from "vitest";
import type { NewUploadedInvoice } from "../db/invoices.js";
import { commitRetry, commitUploadedInvoice } from "./enqueue-invoice.js";
import { createOutboxMemoryPool, type OutboxMemory, type SqlCall, type StoredInvoice } from "./outbox-memory.fixture.js";

const INVOICE_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

const UPLOAD: NewUploadedInvoice = {
  filename: "stored.pdf",
  originalName: "invoice.pdf",
  mimeType: "application/pdf",
  fileSize: 8,
  filePath: "C:/uploads/stored.pdf",
};

function failedRow(retryCount: number): StoredInvoice {
  return {
    id: INVOICE_ID,
    filename: "stored.pdf",
    original_name: "invoice.pdf",
    mime_type: "application/pdf",
    file_size: 8,
    file_path: "C:/uploads/stored.pdf",
    status: "failed",
    error_message: "extract failed",
    retry_count: retryCount,
    extracted_data: null,
    normalized_text: null,
    created_at: "2026-10-23T00:00:00.000Z",
    updated_at: "2026-10-23T00:00:00.000Z",
    completed_at: null,
  };
}

function clientCalls(memory: OutboxMemory): readonly SqlCall[] {
  return memory.clients[0] ?? [];
}

function kind(sql: string): string {
  if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return sql;
  if (sql.includes("UPDATE invoices")) return "UPDATE";
  if (sql.includes("INSERT INTO invoice_outbox")) return "OUTBOX";
  if (sql.includes("INSERT INTO invoices")) return "INVOICE";
  return "OTHER";
}

function eventIdOf(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("eventId" in payload) || typeof payload.eventId !== "string") {
    throw new Error("outbox payload has no eventId");
  }
  return payload.eventId;
}

describe("commitUploadedInvoice", () => {
  it("writes the invoice and outbox on one client and does not publish", async () => {
    const { pool, memory } = createOutboxMemoryPool();
    const row = await commitUploadedInvoice(pool, UPLOAD);
    const sql = clientCalls(memory).map((call) => call.sql);
    expect(memory.clients).toHaveLength(1);
    expect(sql.map(kind)).toEqual(["BEGIN", "INVOICE", "OUTBOX", "COMMIT"]);
    expect(sql).not.toContain("ROLLBACK");
    expect(sql.join("\n").toLowerCase()).not.toContain("kafka");
    expect(memory.outbox[0]?.invoiceId).toBe(row.id);
    expect(eventIdOf(memory.outbox[0]?.payload)).toBe(memory.outbox[0]?.id);
  });

  it("rolls back when the outbox insert throws", async () => {
    const { pool, memory } = createOutboxMemoryPool();
    memory.failOutboxInsert = true;
    await expect(commitUploadedInvoice(pool, UPLOAD)).rejects.toThrow("outbox insert failed");
    const sql = clientCalls(memory).map((call) => call.sql);
    expect(sql.map(kind)).toEqual(["BEGIN", "INVOICE", "OUTBOX", "ROLLBACK"]);
    expect(sql).not.toContain("COMMIT");
    expect(memory.invoices).toHaveLength(0);
    expect(memory.outbox).toHaveLength(0);
  });
});

describe("commitRetry", () => {
  it("commits the move to uploaded and one outbox row", async () => {
    const { pool, memory } = createOutboxMemoryPool();
    const row = failedRow(2);
    memory.invoices.push({ ...row });
    const moved = await commitRetry(pool, row, 3);
    const calls = clientCalls(memory);
    expect(calls.map((call) => kind(call.sql))).toEqual(["BEGIN", "UPDATE", "OUTBOX", "COMMIT"]);
    expect(calls[1]?.sql).toContain("status");
    expect(calls[1]?.params).toContain("uploaded");
    expect(moved).toMatchObject({ status: "uploaded", error_message: null, retry_count: 3 });
    expect(memory.outbox).toHaveLength(1);
  });

  it("rolls back without an outbox row when the update matches nothing", async () => {
    const { pool, memory } = createOutboxMemoryPool();
    const moved = await commitRetry(pool, failedRow(1), 2);
    const sql = clientCalls(memory).map((call) => call.sql);
    expect(moved).toBeUndefined();
    expect(sql.map(kind)).toEqual(["BEGIN", "UPDATE", "ROLLBACK"]);
    expect(sql.some((statement) => statement.includes("invoice_outbox"))).toBe(false);
  });
});
