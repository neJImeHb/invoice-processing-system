import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { insertUploadedInvoice, type InvoiceRecord, type NewUploadedInvoice } from "../db/invoices.js";
import { insertOutbox } from "../db/outbox.js";
import type { ProcessInvoiceEvent } from "../domain/invoice-event.js";
import { transitionInvoice } from "./transitions.js";

export async function commitUploadedInvoice(pool: Pool, invoice: NewUploadedInvoice): Promise<InvoiceRecord> {
  return inTransaction(pool, (client) => commitUpload(client, invoice));
}

export async function commitRetry(
  pool: Pool,
  row: InvoiceRecord,
  retryCount: number,
): Promise<InvoiceRecord | undefined> {
  return inTransaction(pool, (client) => commitRetryMove(client, row, retryCount));
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      return await work(client);
    } catch (error) {
      await rollback(client);
      throw error;
    }
  } finally {
    client.release();
  }
}

async function commitUpload(client: PoolClient, invoice: NewUploadedInvoice): Promise<InvoiceRecord> {
  const row = await insertUploadedInvoice(client, invoice);
  await insertProcessEvent(client, row.id, invoice.filePath, invoice.mimeType);
  await client.query("COMMIT");
  return row;
}

async function commitRetryMove(
  client: PoolClient,
  row: InvoiceRecord,
  retryCount: number,
): Promise<InvoiceRecord | undefined> {
  const moved = await transitionInvoice(client, row.id, "failed", "uploaded", {
    errorMessage: null,
    retryCount,
  });
  if (moved === undefined) {
    await client.query("ROLLBACK");
    return undefined;
  }
  await insertProcessEvent(client, moved.id, moved.file_path, moved.mime_type);
  await client.query("COMMIT");
  return moved;
}

async function insertProcessEvent(
  client: PoolClient,
  invoiceId: string,
  filePath: string,
  mimeType: string,
): Promise<void> {
  const eventId = randomUUID();
  const event: ProcessInvoiceEvent = {
    eventId,
    type: "PROCESS_INVOICE",
    invoiceId,
    filePath,
    mimeType,
    timestamp: new Date().toISOString(),
  };
  await insertOutbox(client, { id: eventId, invoiceId, payload: event });
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    console.error(rollbackError);
  }
}
