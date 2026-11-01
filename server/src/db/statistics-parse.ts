import { isInvoiceStatus } from "./invoices.js";
import type { InvoiceStatistics, RecentInvoice } from "./statistics.js";

export interface StatisticsFields {
  total_count: unknown;
  uploaded_count: unknown;
  processing_count: unknown;
  completed_count: unknown;
  failed_count: unknown;
  total_sum: unknown;
  recent: unknown;
}

export function statisticsFrom(row: StatisticsFields | undefined): InvoiceStatistics {
  if (row === undefined) {
    throw new Error("Invoice statistics query returned no row");
  }
  return {
    total_count: countValue(row.total_count, "total_count"),
    uploaded_count: countValue(row.uploaded_count, "uploaded_count"),
    processing_count: countValue(row.processing_count, "processing_count"),
    completed_count: countValue(row.completed_count, "completed_count"),
    failed_count: countValue(row.failed_count, "failed_count"),
    total_sum: numericText(row.total_sum),
    recent: recentInvoices(row.recent),
  };
}

function recentInvoices(value: unknown): RecentInvoice[] {
  const parsed = parsedJson(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Recent invoice list was not an array");
  }
  if (parsed.length > 20) {
    throw new Error("Recent invoice list exceeded 20 rows");
  }
  return parsed.map(recentInvoice);
}

function recentInvoice(value: unknown): RecentInvoice {
  const row = record(value, "Recent invoice row");
  const status = row.status;
  if (typeof status !== "string" || !isInvoiceStatus(status)) {
    throw new Error("Recent invoice status was not a status");
  }
  return {
    id: textValue(row.id, "id"),
    original_name: textValue(row.original_name, "original_name"),
    status,
    vendor: optionalText(row.vendor, "vendor"),
    currency: optionalText(row.currency, "currency"),
    totalAmount: present(row.totalAmount, "totalAmount"),
    error_message: optionalText(row.error_message, "error_message"),
  };
}

function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return JSON.parse(value) as unknown;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} was not an object`);
  }
  return value as Record<string, unknown>;
}

function countValue(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  throw new Error(`${label} was not a count`);
}

function numericText(value: unknown): string {
  if (typeof value === "string" && /^-?[0-9]+(\.[0-9]+)?$/.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  throw new Error(`total_sum was not numeric: ${String(value)}`);
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} was not text`);
  }
  return value;
}

function optionalText(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  return textValue(value, label);
}

function present(value: unknown, label: string): unknown {
  if (value === undefined) {
    throw new Error(`${label} was missing`);
  }
  return value;
}
