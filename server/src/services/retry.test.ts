import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { AppDependencies, InvoicePublisher } from "../app.js";
import type { InvoiceStatus } from "../db/invoices.js";
import { createOutboxMemoryPool, type OutboxMemory, type StoredInvoice } from "./outbox-memory.fixture.js";
import { retryInvoice } from "./retry.js";
import type { InvoiceStatusNotice, SseHub } from "./sse.js";

const INVOICE_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const MISSING_ID = "8c2e0c0a-4b1e-4f0a-9a1c-6d5e4f3a2b10";

function storedRow(status: InvoiceStatus, retryCount: number): StoredInvoice {
  return {
    id: INVOICE_ID,
    filename: "stored.pdf",
    original_name: "invoice.pdf",
    mime_type: "application/pdf",
    file_size: 8,
    file_path: "C:/uploads/stored.pdf",
    status,
    error_message: "extract failed",
    retry_count: retryCount,
    extracted_data: null,
    normalized_text: null,
    created_at: "2026-10-23T00:00:00.000Z",
    updated_at: "2026-10-23T00:00:00.000Z",
    completed_at: null,
  };
}

function recordingHub(): { readonly sse: SseHub; readonly statuses: InvoiceStatusNotice[] } {
  const statuses: InvoiceStatusNotice[] = [];
  const sse: SseHub = {
    subscribe() {
      return undefined;
    },
    unsubscribe() {
      return undefined;
    },
    publishStatus(event: InvoiceStatusNotice): void {
      statuses.push(event);
    },
    publishDeleted() {
      return undefined;
    },
    close() {
      return undefined;
    },
  };
  return { sse, statuses };
}

function dependencies(pool: Pool, publisher: InvoicePublisher, sse: SseHub): AppDependencies {
  return {
    postgres: { check: () => Promise.resolve(true) },
    kafka: { check: () => Promise.resolve(true) },
    pool,
    uploadsRoot: "uploads",
    publisher,
    sse,
  };
}

function publisher(memory: OutboxMemory, reject: boolean): InvoicePublisher {
  return {
    async publish(): Promise<void> {
      memory.events.push("publish");
      if (reject) throw new Error("broker down");
    },
  };
}

describe("retryInvoice", () => {
  it("stays uploaded when publish rejects", async () => {
    const { pool, memory } = createOutboxMemoryPool();
    memory.invoices.push(storedRow("failed", 4));
    const { sse, statuses } = recordingHub();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await retryInvoice(dependencies(pool, publisher(memory, true), sse), INVOICE_ID);
      expect(result).toEqual({ httpStatus: 200, body: { success: true, status: "uploaded" } });
      expect(memory.invoices[0]).toMatchObject({ status: "uploaded", error_message: null, retry_count: 5 });
      const updates = memory.clients.flat().filter((call) => call.sql.includes("UPDATE invoices"));
      expect(updates).toHaveLength(1);
      expect(updates[0]?.params[2]).toBe("uploaded");
      expect(statuses.map((notice) => notice.status)).toEqual(["uploaded"]);
      expect(memory.outbox[0]?.published).toBe(false);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("returns 409 for a completed invoice without a transaction", async () => {
    const { pool, memory } = createOutboxMemoryPool();
    memory.invoices.push(storedRow("completed", 0));
    const { sse, statuses } = recordingHub();
    const result = await retryInvoice(dependencies(pool, publisher(memory, true), sse), INVOICE_ID);
    expect(result).toEqual({ httpStatus: 409, body: { error: "invoice_not_failed", status: "completed" } });
    expect(memory.events).not.toContain("BEGIN");
    expect(memory.outbox).toHaveLength(0);
    expect(statuses).toHaveLength(0);
  });

  it("returns 404 for a missing invoice without a transaction", async () => {
    const { pool, memory } = createOutboxMemoryPool();
    const { sse } = recordingHub();
    const result = await retryInvoice(dependencies(pool, publisher(memory, true), sse), MISSING_ID);
    expect(result).toEqual({ httpStatus: 404, body: { error: "not_found" } });
    expect(memory.events).not.toContain("BEGIN");
    expect(memory.clients).toHaveLength(0);
  });

  it("returns the raced status when the update matches nothing", async () => {
    const { pool, memory } = createOutboxMemoryPool();
    memory.invoices.push(storedRow("failed", 1));
    memory.loseNextUpdate = true;
    const { sse, statuses } = recordingHub();
    const result = await retryInvoice(dependencies(pool, publisher(memory, true), sse), INVOICE_ID);
    expect(result).toEqual({ httpStatus: 409, body: { error: "invoice_not_failed", status: "processing" } });
    expect(memory.outbox).toHaveLength(0);
    expect(memory.events.filter((sql) => sql === "BEGIN")).toEqual(["BEGIN"]);
    expect(statuses).toHaveLength(0);
    expect(memory.events).not.toContain("publish");
  });
});
