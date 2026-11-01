import type { Pool } from "pg";
import type { AppDependencies } from "../../app.js";
import { parseInvoiceId } from "../../db/invoices.js";
import { retryInvoice, type RetryResult } from "../../services/retry.js";

export interface RetryFailedInvoiceInput {
  readonly id?: string;
  readonly original_name?: string;
}

export interface AmbiguousOriginalName {
  readonly ids: readonly string[];
}

export type RetryFailedInvoiceResult = RetryResult | AmbiguousOriginalName;

const IDS_FOR_ORIGINAL_NAME = `
  SELECT id
  FROM invoices
  WHERE original_name = $1
  ORDER BY id
`;

export async function retryFailedInvoice(
  dependencies: AppDependencies,
  input: RetryFailedInvoiceInput,
): Promise<RetryFailedInvoiceResult> {
  if (input.original_name !== undefined) {
    return retryNamed(dependencies, input.original_name, input.id);
  }
  if (input.id !== undefined) {
    return retryIdentified(dependencies, input.id);
  }
  throw new Error("Retry requires an id or an original_name");
}

async function retryNamed(
  dependencies: AppDependencies,
  originalName: string,
  fallbackId: string | undefined,
): Promise<RetryFailedInvoiceResult> {
  const ids = await idsForOriginalName(dependencies.pool, originalName);
  if (ids.length > 1) {
    return { ids };
  }
  const matched = ids[0];
  if (matched !== undefined) {
    return retryInvoice(dependencies, matched);
  }
  if (fallbackId !== undefined) {
    return retryIdentified(dependencies, fallbackId);
  }
  return { httpStatus: 404, body: { error: "not_found" } };
}

async function retryIdentified(dependencies: AppDependencies, id: string): Promise<RetryResult> {
  const parsed = parseInvoiceId(id);
  if (parsed === undefined) {
    return { httpStatus: 404, body: { error: "not_found" } };
  }
  return retryInvoice(dependencies, parsed);
}

async function idsForOriginalName(pool: Pool, originalName: string): Promise<string[]> {
  const result = await pool.query<{ id: unknown }>(IDS_FOR_ORIGINAL_NAME, [originalName]);
  return result.rows.map((row) => readId(row.id));
}

function readId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Invoice id was not text");
  }
  return value;
}
