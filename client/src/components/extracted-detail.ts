import { isRecord } from "../api/guards";

export interface LineItemDetail {
  readonly description: string;
  readonly quantity: number | null;
  readonly unitPrice: number | null;
  readonly total: number | null;
}

export interface InvoiceExtractionView {
  readonly vendor: string;
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly currency: string;
  readonly tax: number | null;
  readonly total: number | null;
  readonly lineItems: readonly LineItemDetail[];
}

export function readInvoiceExtraction(data: unknown): InvoiceExtractionView {
  const record = isRecord(data) ? data : undefined;
  const vendor = nested(record, "vendor");
  const dates = nested(record, "dates");
  const financials = nested(record, "financials");
  return {
    vendor: readText(vendor?.name),
    invoiceNumber: readText(record?.invoiceNumber),
    issueDate: readText(dates?.issueDate),
    dueDate: readText(dates?.dueDate),
    currency: readText(financials?.currency),
    tax: readAmount(financials?.taxAmount),
    total: readAmount(financials?.totalAmount),
    lineItems: readLineItems(record?.lineItems),
  };
}

export function displayAmount(amount: number | null): string {
  if (amount === null) {
    return "absent";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount);
}

function nested(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (record === undefined) {
    return undefined;
  }
  const value = record[key];
  if (!isRecord(value)) {
    return undefined;
  }
  return value;
}

function readLineItems(value: unknown): LineItemDetail[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => readLineItem(item));
}

function readLineItem(value: unknown): LineItemDetail {
  if (!isRecord(value)) {
    return { description: "absent", quantity: null, unitPrice: null, total: null };
  }
  return {
    description: readText(value.description),
    quantity: readAmount(value.quantity),
    unitPrice: readAmount(value.unitPrice),
    total: readAmount(value.totalPrice),
  };
}

function readText(value: unknown): string {
  if (typeof value !== "string") {
    return "absent";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "absent";
  }
  return trimmed;
}

function readAmount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}
