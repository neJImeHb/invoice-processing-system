import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { expect, type APIRequestContext, type Locator, type Page, type Response } from "@playwright/test";
import { doubleClickRetry, moveOffFailed } from "./status-log";

export { doubleClickRetry, moveOffFailed };

const API_ORIGIN = "http://127.0.0.1:3001";
const STATUS_TIMEOUT = 90_000;

export function uniquePdfName(label: string): string {
  return `e2e-retry-${label}-${randomUUID()}.pdf`;
}

export function tempPdfPath(filename: string): string {
  return path.join(os.tmpdir(), filename);
}

export function normalPdf(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
}

export function encryptedPdf(): Buffer {
  return Buffer.concat([normalPdf(), Buffer.from("\n/Encrypt")]);
}

export async function uploadFailedEncrypted(
  page: Page,
  pdfPath: string,
  filename: string,
): Promise<{ id: string; row: Locator }> {
  const id = await uploadPdf(page, pdfPath);
  const row = invoiceRow(page, filename);
  await expect(row.getByText("failed", { exact: true })).toBeVisible({ timeout: STATUS_TIMEOUT });
  await expect(row.getByText("Invoice file is encrypted", { exact: true })).toBeVisible();
  return { id, row };
}

export async function uploadPdf(page: Page, pdfPath: string): Promise<string> {
  const input = page.locator("input[type=file]");
  await expect(input).toBeVisible();
  const posted = page.waitForResponse(isAcceptedUpload);
  await input.setInputFiles(pdfPath);
  const response = await posted;
  const payload: unknown = await response.json();
  return readUploadId(payload);
}

export function invoiceRow(page: Page, filename: string): Locator {
  return page.locator("tbody tr").filter({ hasText: filename });
}

export async function expectSettledRetry(request: APIRequestContext, invoiceId: string): Promise<void> {
  await expect.poll(async () => readSnapshot(request, invoiceId), { timeout: STATUS_TIMEOUT }).toEqual({
    status: "failed",
    retryCount: 1,
  });
}

export function collectRetryStatuses(page: Page, invoiceId: string, statuses: number[]): void {
  page.on("response", (response) => {
    if (isInvoiceRetry(response, invoiceId)) {
      statuses.push(response.status());
    }
  });
}

function isAcceptedUpload(response: Response): boolean {
  return response.request().method() === "POST" && response.url().includes("/api/invoices/upload") && response.status() === 202;
}

function readUploadId(payload: unknown): string {
  if (!isObject(payload) || typeof payload.id !== "string" || payload.id.length === 0) {
    throw new Error("Upload response did not include an id");
  }
  return payload.id;
}

function isInvoiceRetry(response: Response, invoiceId: string): boolean {
  if (response.request().method() !== "POST") {
    return false;
  }
  return new URL(response.url()).pathname === `/api/invoices/${invoiceId}/retry`;
}

async function readSnapshot(request: APIRequestContext, invoiceId: string): Promise<{ status: string; retryCount: number }> {
  const response = await request.get(`${API_ORIGIN}/api/invoices/${invoiceId}`);
  if (!response.ok()) {
    throw new Error(`GET /api/invoices/${invoiceId} failed with ${String(response.status())}`);
  }
  const payload: unknown = await response.json();
  return snapshotFrom(payload);
}

function snapshotFrom(payload: unknown): { status: string; retryCount: number } {
  const invoice = detailInvoice(payload);
  return { status: requiredStatus(invoice.status), retryCount: requiredCount(invoice.retry_count) };
}

function detailInvoice(payload: unknown): Record<string, unknown> {
  if (!isObject(payload) || !isObject(payload.invoice)) {
    throw new Error("Invoice detail did not include an invoice");
  }
  return payload.invoice;
}

function requiredStatus(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Invoice detail omitted status");
  }
  return value;
}

function requiredCount(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  throw new Error("retry_count was not a count");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
