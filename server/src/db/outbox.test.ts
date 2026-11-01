import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { ProcessInvoiceEvent } from "../domain/invoice-event.js";
import { insertOutbox, listUnpublishedOutbox, listUploadedMissingOutbox, markOutboxPublished } from "./outbox.js";

const validEvent: ProcessInvoiceEvent = {
  eventId: "8c2e0c0a-4b1e-4f0a-9a1c-6d5e4f3a2b10",
  type: "PROCESS_INVOICE",
  invoiceId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  filePath: "C:/uploads/a.pdf",
  mimeType: "application/pdf",
  timestamp: "2026-10-21T10:00:00.000Z",
};

interface RecordedQuery {
  readonly sql: string;
  readonly params: readonly unknown[] | undefined;
}

interface CannedRows {
  readonly unpublished: readonly unknown[];
  readonly missing: readonly unknown[];
}

function createFakeClient(canned?: Partial<CannedRows>): { readonly calls: RecordedQuery[]; readonly client: Pool } {
  const calls: RecordedQuery[] = [];
  const rows: CannedRows = {
    unpublished: canned?.unpublished ?? [],
    missing: canned?.missing ?? [],
  };
  const query = (sql: string, params?: readonly unknown[]): Promise<{ rows: readonly unknown[]; rowCount: number }> => {
    calls.push({ sql, params });
    return Promise.resolve({ rows: rowsForSql(sql, rows), rowCount: 0 });
  };
  return { calls, client: { query } as unknown as Pool };
}

function rowsForSql(sql: string, rows: CannedRows): readonly unknown[] {
  if (sql.includes("INSERT INTO invoice_outbox")) {
    return [];
  }
  if (sql.includes("ORDER BY created_at ASC, id ASC")) {
    return rows.unpublished;
  }
  if (sql.includes("SET published_at = NOW()")) {
    return [];
  }
  if (sql.includes("NOT EXISTS")) {
    return rows.missing;
  }
  throw new Error(`No canned rows for SQL: ${sql}`);
}

function recordedQuery(calls: readonly RecordedQuery[]): RecordedQuery {
  expect(calls).toHaveLength(1);
  const call = calls[0];
  if (call === undefined) {
    throw new Error("expected one query");
  }
  return call;
}

describe("insertOutbox", () => {
  it("inserts the id, invoice id, and stringified payload", async () => {
    const db = createFakeClient();
    await insertOutbox(db.client, {
      id: validEvent.eventId,
      invoiceId: validEvent.invoiceId,
      payload: validEvent,
    });
    const call = recordedQuery(db.calls);
    expect(call.sql).toContain("INSERT INTO invoice_outbox");
    expect(call.params).toEqual([validEvent.eventId, validEvent.invoiceId, JSON.stringify(validEvent)]);
  });
});

describe("listUnpublishedOutbox", () => {
  it("reads unpublished rows in order and parses a jsonb object", async () => {
    const db = createFakeClient({
      unpublished: [
        {
          id: validEvent.eventId,
          invoice_id: validEvent.invoiceId,
          payload: { ...validEvent },
        },
      ],
    });
    const rows = await listUnpublishedOutbox(db.client);
    const call = recordedQuery(db.calls);
    expect(call.sql).toContain("published_at IS NULL");
    expect(call.sql).toContain("ORDER BY created_at ASC, id ASC");
    expect(rows).toEqual([
      {
        id: validEvent.eventId,
        invoiceId: validEvent.invoiceId,
        payload: validEvent,
      },
    ]);
  });

  it("parses a string payload", async () => {
    const db = createFakeClient({
      unpublished: [
        {
          id: validEvent.eventId,
          invoice_id: validEvent.invoiceId,
          payload: JSON.stringify(validEvent),
        },
      ],
    });
    await expect(listUnpublishedOutbox(db.client)).resolves.toEqual([
      {
        id: validEvent.eventId,
        invoiceId: validEvent.invoiceId,
        payload: validEvent,
      },
    ]);
  });

  it("rejects a payload that fails the schema", async () => {
    const db = createFakeClient({
      unpublished: [
        {
          id: validEvent.eventId,
          invoice_id: validEvent.invoiceId,
          payload: { ...validEvent, filePath: "" },
        },
      ],
    });
    await expect(listUnpublishedOutbox(db.client)).rejects.toThrow();
  });
});

describe("markOutboxPublished", () => {
  it("sets published_at only when it is still null", async () => {
    const db = createFakeClient();
    await markOutboxPublished(db.client, validEvent.eventId);
    const call = recordedQuery(db.calls);
    expect(call.sql).toContain("SET published_at = NOW()");
    expect(call.sql).toContain("published_at IS NULL");
    expect(call.params).toEqual([validEvent.eventId]);
  });
});

describe("listUploadedMissingOutbox", () => {
  it("returns uploaded invoices that have no outbox row", async () => {
    const db = createFakeClient({
      missing: [
        {
          id: validEvent.invoiceId,
          file_path: validEvent.filePath,
          mime_type: validEvent.mimeType,
        },
      ],
    });
    const rows = await listUploadedMissingOutbox(db.client);
    const call = recordedQuery(db.calls);
    expect(call.sql).toContain("status = 'uploaded'");
    expect(call.sql).toContain("NOT EXISTS");
    expect(call.sql).not.toContain("processing");
    expect(rows).toEqual([
      {
        id: validEvent.invoiceId,
        filePath: validEvent.filePath,
        mimeType: validEvent.mimeType,
      },
    ]);
  });
});
