import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { ProcessInvoiceEventSchema } from "../domain/extraction.js";
import type { ProcessInvoiceEvent } from "../domain/invoice-event.js";

export interface InvoiceOutboxRecord {
  readonly id: string;
  readonly invoiceId: string;
  readonly payload: ProcessInvoiceEvent;
}

export interface UploadedMissingOutbox {
  readonly id: string;
  readonly filePath: string;
  readonly mimeType: string;
}

interface OutboxQueryRow {
  id: string;
  invoice_id: string;
  payload: unknown;
}

interface MissingOutboxQueryRow {
  id: string;
  file_path: string;
  mime_type: string;
}

const INSERT_OUTBOX_SQL =
  "INSERT INTO invoice_outbox (id, invoice_id, payload) VALUES ($1::uuid, $2::uuid, $3::jsonb)";

const LIST_UNPUBLISHED_SQL =
  "SELECT id, invoice_id, payload FROM invoice_outbox WHERE published_at IS NULL ORDER BY created_at ASC, id ASC";

const MARK_PUBLISHED_SQL =
  "UPDATE invoice_outbox SET published_at = NOW() WHERE id = $1::uuid AND published_at IS NULL";

const LIST_UPLOADED_MISSING_SQL =
  "SELECT i.id, i.file_path, i.mime_type FROM invoices i WHERE i.status = 'uploaded' AND NOT EXISTS (SELECT 1 FROM invoice_outbox o WHERE o.invoice_id = i.id)";

export async function insertOutbox(client: Pool | PoolClient, row: InvoiceOutboxRecord): Promise<void> {
  await runQuery(client, INSERT_OUTBOX_SQL, [row.id, row.invoiceId, JSON.stringify(row.payload)]);
}

export async function listUnpublishedOutbox(client: Pool | PoolClient): Promise<InvoiceOutboxRecord[]> {
  const rows = await queryRows<OutboxQueryRow>(client, LIST_UNPUBLISHED_SQL, []);
  return rows.map(toOutboxRecord);
}

export async function markOutboxPublished(client: Pool | PoolClient, id: string): Promise<void> {
  await runQuery(client, MARK_PUBLISHED_SQL, [id]);
}

export async function listUploadedMissingOutbox(client: Pool | PoolClient): Promise<UploadedMissingOutbox[]> {
  const rows = await queryRows<MissingOutboxQueryRow>(client, LIST_UPLOADED_MISSING_SQL, []);
  return rows.map(toMissingOutbox);
}

function toOutboxRecord(row: OutboxQueryRow): InvoiceOutboxRecord {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    payload: parsePayload(row.payload),
  };
}

function parsePayload(value: unknown): ProcessInvoiceEvent {
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    return ProcessInvoiceEventSchema.parse(parsed);
  }
  return ProcessInvoiceEventSchema.parse(value);
}

function toMissingOutbox(row: MissingOutboxQueryRow): UploadedMissingOutbox {
  return {
    id: row.id,
    filePath: row.file_path,
    mimeType: row.mime_type,
  };
}

async function queryRows<T extends QueryResultRow>(
  client: Pool | PoolClient,
  sql: string,
  values: unknown[],
): Promise<T[]> {
  const result = await runQuery<T>(client, sql, values);
  return result.rows;
}

function runQuery<T extends QueryResultRow>(
  client: Pool | PoolClient,
  sql: string,
  values: unknown[],
): Promise<QueryResult<T>> {
  if (isPoolClient(client)) {
    return client.query<T>(sql, values);
  }
  return client.query<T>(sql, values);
}

function isPoolClient(client: Pool | PoolClient): client is PoolClient {
  return "release" in client;
}
