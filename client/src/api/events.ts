import { isInvoiceStatus, type InvoiceStatusEvent } from "../state/invoices";
import { isRecord } from "./guards";

export const INVOICE_EVENTS_PATH = "/api/events/invoices";

export function parseStatusChange(data: string): InvoiceStatusEvent {
  const payload: unknown = JSON.parse(data);
  if (!isRecord(payload)) {
    throw new Error("Status event was not an object");
  }
  const { invoiceId, status, updatedAt, errorMessage } = payload;
  if (typeof invoiceId !== "string" || !isStatus(status) || typeof updatedAt !== "string") {
    throw new Error("Status event is missing invoiceId, status, or updatedAt");
  }
  if (errorMessage !== null && typeof errorMessage !== "string") {
    throw new Error("Status event errorMessage was not a string or null");
  }
  return { invoiceId, status, errorMessage, updatedAt };
}

export function parseDeletedInvoiceId(data: string): string {
  const payload: unknown = JSON.parse(data);
  if (!isRecord(payload) || typeof payload.invoiceId !== "string") {
    throw new Error("Delete event is missing invoiceId");
  }
  return payload.invoiceId;
}

function isStatus(value: unknown): value is InvoiceStatusEvent["status"] {
  return typeof value === "string" && isInvoiceStatus(value);
}
