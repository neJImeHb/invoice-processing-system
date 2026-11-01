import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "vitest";
import type { ProcessInvoiceEvent } from "../src/domain/invoice-event.js";
import { countInvoices, listFiles, postFile, type RunningUploadTest, type UploadPart } from "./upload-harness.js";

const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg)$/i;
const EVENT_KEYS = ["eventId", "filePath", "invoiceId", "mimeType", "timestamp", "type"];

interface StoredRow {
  filename: string;
  original_name: string;
  mime_type: string;
  status: string;
  file_path: string;
  file_size: string | number;
}

export async function expectAccepted(
  ctx: RunningUploadTest,
  part: UploadPart,
  display: string,
): Promise<string> {
  const response = await postFile(ctx.baseUrl, part);
  expect(response.status).toBe(202);
  const body = await readRecord(response);
  expect(readString(body, "filename")).toBe(display);
  expect(display.includes("/") || display.includes("\\")).toBe(false);
  expect(readString(body, "status")).toBe("uploaded");
  const id = readString(body, "id");
  ctx.createdIds.push(id);
  return id;
}

export async function expectStored(
  ctx: RunningUploadTest,
  id: string,
  part: UploadPart,
  display: string,
): Promise<string> {
  const selected = await ctx.pool.query<StoredRow>(
    `SELECT filename, original_name, mime_type, status, file_path, file_size
     FROM invoices WHERE id = $1`,
    [id],
  );
  const row = selected.rows[0];
  if (row === undefined) {
    throw new Error("stored invoice row was missing");
  }
  expect(row.filename).toMatch(STORED_NAME);
  expect(row.filename.endsWith(extensionFor(part.mime))).toBe(true);
  expect(row.original_name).toBe(display);
  expect(row.mime_type).toBe(part.mime);
  expect(row.status).toBe("uploaded");
  expect(row.file_path).toBe(path.resolve(ctx.uploadsRoot, row.filename));
  expect(Number(row.file_size)).toBe(part.bytes.length);
  expect((await readFile(row.file_path)).equals(part.bytes)).toBe(true);
  expectPublished(ctx, id, row.file_path, row.mime_type);
  return row.file_path;
}

export async function expectRejection(
  ctx: RunningUploadTest,
  part: UploadPart | undefined,
  status: number,
  error: string,
): Promise<void> {
  const beforeCount = await countInvoices(ctx.pool);
  const beforeFiles = await listFiles(ctx.uploadsRoot);
  const response = part === undefined
    ? await fetch(`${ctx.baseUrl}/api/invoices/upload`, { method: "POST" })
    : await postFile(ctx.baseUrl, part);
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual({ error });
  expect(await countInvoices(ctx.pool)).toBe(beforeCount);
  expect(await listFiles(ctx.uploadsRoot)).toEqual(beforeFiles);
}

export async function readRecord(response: Response): Promise<object> {
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("expected a JSON object");
  }
  return body;
}

export async function readRows(response: Response): Promise<object[]> {
  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new Error("expected a JSON array");
  }
  return body.filter((item): item is object => typeof item === "object" && item !== null);
}

export function readString(value: object, key: string): string {
  const field = Reflect.get(value, key);
  if (typeof field !== "string") {
    throw new Error(`${key} was not a string`);
  }
  return field;
}

export function readNumber(value: object, key: string): number {
  const field = Reflect.get(value, key);
  if (typeof field !== "number") {
    throw new Error(`${key} was not a number`);
  }
  return field;
}

function expectPublished(ctx: RunningUploadTest, id: string, filePath: string, mimeType: string): void {
  const calls = ctx.published.filter((item) => item.invoiceId === id);
  expect(calls).toHaveLength(1);
  const event = calls[0]?.event;
  if (event === undefined) {
    throw new Error("publisher event was missing");
  }
  expect(Object.keys(event).sort()).toEqual(EVENT_KEYS);
  expect(event.type).toBe("PROCESS_INVOICE");
  expect(event.invoiceId).toBe(id);
  expect(event.filePath).toBe(filePath);
  expect(event.mimeType).toBe(mimeType);
  expect(event.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
  assertExactEvent(event);
}

function assertExactEvent(event: ProcessInvoiceEvent): void {
  const copy: ProcessInvoiceEvent = {
    eventId: event.eventId,
    type: event.type,
    invoiceId: event.invoiceId,
    filePath: event.filePath,
    mimeType: event.mimeType,
    timestamp: event.timestamp,
  };
  expect(copy).toEqual(event);
}

function extensionFor(mime: string): string {
  if (mime === "application/pdf") {
    return ".pdf";
  }
  if (mime === "image/png") {
    return ".png";
  }
  return ".jpg";
}
