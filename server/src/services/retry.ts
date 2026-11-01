import type { AppDependencies } from "../app.js";
import { findInvoiceById, type InvoiceRecord, type InvoiceStatus } from "../db/invoices.js";
import { commitRetry } from "./enqueue-invoice.js";
import { publishInvoiceStatus } from "./invoice-status.js";
import { drainOutbox } from "./outbox-relay.js";

export interface RetryResult {
  readonly httpStatus: 200 | 404 | 409;
  readonly body: RetryBody;
}

export type RetryBody =
  | { readonly success: true; readonly status: "uploaded" }
  | { readonly error: "not_found" }
  | { readonly error: "invoice_not_failed"; readonly status: InvoiceStatus };

export async function retryInvoice(dependencies: AppDependencies, id: string): Promise<RetryResult> {
  const row = await findInvoiceById(dependencies.pool, id);
  if (row === undefined) {
    return { httpStatus: 404, body: { error: "not_found" } };
  }
  if (row.status !== "failed") {
    return notFailed(row.status);
  }
  return queueFailedInvoice(dependencies, row);
}

async function queueFailedInvoice(dependencies: AppDependencies, row: InvoiceRecord): Promise<RetryResult> {
  const moved = await commitRetry(dependencies.pool, row, countedRetries(row.retry_count) + 1);
  if (moved === undefined) {
    return lostRace(dependencies, row.id);
  }
  try {
    await drainOutbox(dependencies.pool, dependencies.publisher);
  } catch (error) {
    console.error(error);
  }
  publishInvoiceStatus(dependencies.sse, moved);
  return { httpStatus: 200, body: { success: true, status: "uploaded" } };
}

async function lostRace(dependencies: AppDependencies, id: string): Promise<RetryResult> {
  const current = await findInvoiceById(dependencies.pool, id);
  return notFailed(current?.status ?? "uploaded");
}

function notFailed(status: InvoiceStatus): RetryResult {
  return { httpStatus: 409, body: { error: "invoice_not_failed", status } };
}

function countedRetries(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  throw new Error("Invoice retry_count was not a count");
}
