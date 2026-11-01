import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export const INVOICE_STATUSES = ["uploaded", "processing", "completed", "failed"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceRecord {
  readonly id: string;
  readonly filename: string;
  readonly original_name: string;
  readonly mime_type: string;
  readonly file_size: string | number;
  readonly file_path: string;
  readonly status: InvoiceStatus;
  readonly error_message: string | null;
  readonly retry_count: number;
  readonly extracted_data: unknown;
  readonly normalized_text: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly completed_at: Date | string | null;
}

export interface NewUploadedInvoice {
  readonly filename: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly filePath: string;
}

export interface InvoiceListFilter {
  readonly status: InvoiceStatus | undefined;
  readonly limit: number;
  readonly offset: number;
}

export const INVOICE_COLUMNS =
  "id, filename, original_name, mime_type, file_size, file_path, status, error_message, retry_count, extracted_data, normalized_text, created_at, updated_at, completed_at";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isInvoiceStatus(value: string): value is InvoiceStatus {
  return INVOICE_STATUSES.some((status) => status === value);
}

export function parseInvoiceId(value: string): string | undefined {
  if (!UUID_PATTERN.test(value)) {
    return undefined;
  }
  return value;
}

export async function insertUploadedInvoice(
  client: Pool | PoolClient,
  invoice: NewUploadedInvoice,
): Promise<InvoiceRecord> {
  const result = await runQuery<InvoiceRecord>(
    client,
    `INSERT INTO invoices (filename, original_name, mime_type, file_size, file_path)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${INVOICE_COLUMNS}`,
    [invoice.filename, invoice.originalName, invoice.mimeType, invoice.fileSize, invoice.filePath],
  );
  return requiredRow(result.rows[0]);
}

export async function listInvoices(pool: Pool, filter: InvoiceListFilter): Promise<InvoiceRecord[]> {
  const result = await pool.query<InvoiceRecord>(
    `SELECT ${INVOICE_COLUMNS}
     FROM invoices
     WHERE ($1::text IS NULL OR status = $1::invoice_status)
     ORDER BY created_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [filter.status ?? null, filter.limit, filter.offset],
  );
  return result.rows;
}

export async function findInvoiceById(pool: Pool, id: string): Promise<InvoiceRecord | undefined> {
  const result = await pool.query<InvoiceRecord>(
    `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

export async function countInvoiceChunks(pool: Pool, invoiceId: string): Promise<number> {
  const result = await pool.query<{ chunks_count: unknown }>(
    "SELECT COUNT(*)::int AS chunks_count FROM invoice_chunks WHERE invoice_id = $1",
    [invoiceId],
  );
  return requiredCount(result.rows[0]?.chunks_count);
}

export async function deleteInvoiceById(pool: Pool, id: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM invoices WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
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

function requiredRow(row: InvoiceRecord | undefined): InvoiceRecord {
  if (row === undefined) {
    throw new Error("Invoice insert did not return a row");
  }
  return row;
}

function requiredCount(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  throw new Error("Invoice chunk count was not an integer");
}
