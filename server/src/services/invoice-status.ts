import type { InvoiceRecord } from "../db/invoices.js";
import type { SseHub } from "./sse.js";

export function publishInvoiceStatus(sse: SseHub, row: InvoiceRecord): void {
  sse.publishStatus({
    invoiceId: row.id,
    status: row.status,
    errorMessage: row.error_message,
    updatedAt: isoTimestamp(row.updated_at),
  });
}

function isoTimestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invoice updated_at was not a timestamp");
  }
  return parsed.toISOString();
}
