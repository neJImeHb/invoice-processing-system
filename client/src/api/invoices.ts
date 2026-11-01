import { isInvoiceStatus, type InvoiceRow, type InvoiceStatus } from "../state/invoices";
import { isRecord } from "./guards";

export async function fetchInvoices(): Promise<InvoiceRow[]> {
  const response = await fetch("/api/invoices");
  if (!response.ok) {
    throw new Error(`GET /api/invoices failed with ${String(response.status)}`);
  }
  const payload: unknown = await response.json();
  return parseInvoiceList(payload);
}

export function parseInvoiceList(payload: unknown): InvoiceRow[] {
  if (!Array.isArray(payload)) {
    throw new Error("Invoice list was not an array");
  }
  return payload.map((item) => parseInvoiceRow(item));
}

function parseInvoiceRow(item: unknown): InvoiceRow {
  if (!isRecord(item)) {
    throw new Error("Invoice row was not an object");
  }
  return {
    id: requiredString(item, "id"),
    filename: requiredString(item, "filename"),
    original_name: requiredString(item, "original_name"),
    mime_type: requiredString(item, "mime_type"),
    file_size: requiredFileSize(item.file_size),
    status: requiredStatus(item.status),
    error_message: requiredErrorMessage(item.error_message),
    extracted_data: item.extracted_data ?? null,
    normalized_text: optionalText(item.normalized_text),
    created_at: requiredString(item, "created_at"),
    updated_at: requiredString(item, "updated_at"),
  };
}

export function invoiceFilePath(id: string): string {
  return `${invoicePath(id)}/file`;
}

export async function fetchInvoice(id: string): Promise<InvoiceRow> {
  const response = await fetch(invoicePath(id));
  if (!response.ok) {
    throw new Error(await failureMessage(response, "Could not load invoice details"));
  }
  const payload: unknown = await response.json();
  return parseInvoiceDetail(payload);
}

export async function deleteInvoice(id: string): Promise<void> {
  const response = await fetch(invoicePath(id), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await failureMessage(response, "Could not delete the invoice"));
  }
  await response.text();
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Invoice ${key} was not a string`);
  }
  return value;
}

function requiredStatus(value: unknown): InvoiceStatus {
  if (typeof value === "string" && isInvoiceStatus(value)) {
    return value;
  }
  throw new Error("Invoice status was not a known status");
}

function requiredErrorMessage(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  throw new Error("Invoice error_message was not a string or null");
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  throw new Error("Invoice normalized_text was not a string or null");
}

function parseInvoiceDetail(payload: unknown): InvoiceRow {
  if (!isRecord(payload)) {
    throw new Error("Invoice detail was not an object");
  }
  if (typeof payload.chunksCount !== "number" || !Number.isInteger(payload.chunksCount) || payload.chunksCount < 0) {
    throw new Error("Invoice detail chunksCount was not a count");
  }
  return parseInvoiceRow(payload.invoice);
}

function invoicePath(id: string): string {
  return `/api/invoices/${encodeURIComponent(id)}`;
}

async function failureMessage(response: Response, fallback: string): Promise<string> {
  const code = readErrorCode(await response.text());
  if (code === "not_found") {
    return "That invoice was not found.";
  }
  if (code !== undefined) {
    return `${fallback}: ${code}.`;
  }
  return `${fallback} (${String(response.status)}).`;
}

function readErrorCode(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    console.error(error);
    return undefined;
  }
  if (!isRecord(payload) || typeof payload.error !== "string" || payload.error.length === 0) {
    return undefined;
  }
  return payload.error;
}

function requiredFileSize(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  throw new Error("Invoice file_size was not a byte count");
}
