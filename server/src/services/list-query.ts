import { isInvoiceStatus, type InvoiceListFilter, type InvoiceStatus } from "../db/invoices.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function parseListQuery(query: object): InvoiceListFilter | "invalid_status" {
  const status = parseStatus(readKey(query, "status"));
  if (status === "invalid") {
    return "invalid_status";
  }
  return {
    status,
    limit: parseLimit(readKey(query, "limit")),
    offset: parseOffset(readKey(query, "offset")),
  };
}

function readKey(query: object, key: string): unknown {
  if (!Object.hasOwn(query, key)) {
    return undefined;
  }
  return Reflect.get(query, key);
}

function parseStatus(raw: unknown): InvoiceStatus | undefined | "invalid" {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string" || !isInvoiceStatus(raw)) {
    return "invalid";
  }
  return raw;
}

function parseLimit(raw: unknown): number {
  const value = wholeNumber(raw);
  if (value === undefined || value < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(value, MAX_LIMIT);
}

function parseOffset(raw: unknown): number {
  const value = wholeNumber(raw);
  if (value === undefined || value < 0) {
    return 0;
  }
  return value;
}

function wholeNumber(raw: unknown): number | undefined {
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    return undefined;
  }
  return value;
}
