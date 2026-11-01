import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { INVOICE_COLUMNS, type InvoiceRecord, type InvoiceStatus } from "../db/invoices.js";

export interface InvoiceTransitionPatch {
  readonly errorMessage?: string | null;
  readonly retryCount?: number;
  readonly extractedData?: unknown;
  readonly normalizedText?: string | null;
  readonly completedAt?: Date | null;
}

interface PatchColumn {
  readonly column: string;
  readonly value: unknown;
  readonly cast: "jsonb" | undefined;
}

export async function transitionInvoice(
  client: Pool | PoolClient,
  id: string,
  from: InvoiceStatus,
  to: InvoiceStatus,
  patch: InvoiceTransitionPatch,
): Promise<InvoiceRecord | undefined> {
  const values: unknown[] = [id, from, to];
  const sets = ["status = $3::invoice_status", "updated_at = NOW()"];
  for (const column of patchColumns(patch)) {
    values.push(column.value);
    const cast = column.cast === undefined ? "" : `::${column.cast}`;
    sets.push(`${column.column} = $${String(values.length)}${cast}`);
  }
  const rows = await queryRows<InvoiceRecord>(
    client,
    `UPDATE invoices SET ${sets.join(", ")} WHERE id = $1::uuid AND status = $2::invoice_status RETURNING ${INVOICE_COLUMNS}`,
    values,
  );
  return rows[0];
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

function patchColumns(patch: InvoiceTransitionPatch): PatchColumn[] {
  const columns: PatchColumn[] = [];
  if ("errorMessage" in patch) {
    columns.push({ column: "error_message", value: patch.errorMessage ?? null, cast: undefined });
  }
  if (patch.retryCount !== undefined) {
    columns.push({ column: "retry_count", value: wholeRetryCount(patch.retryCount), cast: undefined });
  }
  if ("extractedData" in patch) {
    columns.push({ column: "extracted_data", value: jsonValue(patch.extractedData), cast: "jsonb" });
  }
  if ("normalizedText" in patch) {
    columns.push({ column: "normalized_text", value: patch.normalizedText ?? null, cast: undefined });
  }
  if ("completedAt" in patch) {
    columns.push({ column: "completed_at", value: patch.completedAt ?? null, cast: undefined });
  }
  return columns;
}

function wholeRetryCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Invoice retry_count was not a count");
  }
  return value;
}

function jsonValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}
