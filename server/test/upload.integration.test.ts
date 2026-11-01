delete process.env.GEMINI_API_KEY;

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { htmlBytes, jpegBytes, pdfBytes, pdfOfSize, pngBytes } from "./upload-bytes.js";
import { expectAccepted, expectRejection, expectStored, readNumber, readRecord, readString } from "./upload-assertions.js";
import { postFile, startUploadTest, type RunningUploadTest, type UploadPart } from "./upload-harness.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

describe("invoice upload", () => {
  let ctx: RunningUploadTest | undefined;
  let sentinel: string | undefined;

  beforeAll(async () => {
    ctx = await startUploadTest();
  }, 300_000);

  afterAll(async () => {
    const extras = sentinel === undefined ? [] : [sentinel];
    await ctx?.cleanup(extras);
  });

  function current(): RunningUploadTest {
    if (ctx === undefined) {
      throw new Error("upload test did not start");
    }
    return ctx;
  }

  it("stores a pdf, png, and jpeg and publishes one job each", async () => {
    const app = current();
    const pdf = { bytes: pdfBytes(), mime: "application/pdf", filename: "invoice.pdf" };
    const png = { bytes: pngBytes(), mime: "image/png", filename: "scan.png" };
    const jpeg = { bytes: jpegBytes(), mime: "image/jpeg", filename: "photo.jpg" };
    await expectStored(app, await expectAccepted(app, pdf, "invoice.pdf"), pdf, "invoice.pdf");
    await expectStored(app, await expectAccepted(app, png, "scan.png"), png, "scan.png");
    await expectStored(app, await expectAccepted(app, jpeg, "photo.jpg"), jpeg, "photo.jpg");
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });

  it("stores only the base name when the client sends a path", async () => {
    const app = current();
    const bytes = pdfBytes();
    const relative = { bytes, mime: "application/pdf", filename: "..\\..\\secret.pdf" };
    const absolute = { bytes, mime: "application/pdf", filename: "C:\\temp\\secret.pdf" };
    await expectStored(app, await expectAccepted(app, relative, "secret.pdf"), relative, "secret.pdf");
    await expectStored(app, await expectAccepted(app, absolute, "secret.pdf"), absolute, "secret.pdf");
  });

  it("rejects an empty body, a zero-length file, and a bad signature", async () => {
    const app = current();
    await expectRejection(app, undefined, 400, "empty_body");
    await expectRejection(app, { bytes: Buffer.alloc(0), mime: "application/pdf", filename: "empty.pdf" }, 400, "empty_body");
    await expectRejection(app, { bytes: htmlBytes(), mime: "application/pdf", filename: "note.pdf" }, 415, "unsupported_media");
    await expectRejection(app, { bytes: pdfBytes(), mime: "image/png", filename: "x.png" }, 415, "unsupported_media");
    await expectRejection(app, { bytes: jpegBytes(), mime: "image/jpg", filename: "x.jpg" }, 415, "unsupported_media");
  });

  it("rejects 20 MB plus one byte and accepts exactly 20 MB", async () => {
    const app = current();
    const exact = pdfOfSize(MAX_UPLOAD_BYTES);
    await expectRejection(
      app,
      { bytes: pdfOfSize(MAX_UPLOAD_BYTES + 1), mime: "application/pdf", filename: "over.pdf" },
      413,
      "file_too_large",
    );
    const part = { bytes: exact, mime: "application/pdf", filename: "exact.pdf" };
    await expectStored(app, await expectAccepted(app, part, "exact.pdf"), part, "exact.pdf");
  });

  it("returns the invoice and file, then delete removes both", async () => {
    const app = current();
    const part = { bytes: pdfBytes(), mime: "application/pdf", filename: "detail.pdf" };
    const id = await expectAccepted(app, part, "detail.pdf");
    const filePath = await expectStored(app, id, part, "detail.pdf");
    const detail = await fetch(`${app.baseUrl}/api/invoices/${id}`);
    expect(detail.status).toBe(200);
    const body = await readRecord(detail);
    expect(readNumber(body, "chunksCount")).toBe(0);
    const invoice = Reflect.get(body, "invoice");
    if (typeof invoice !== "object" || invoice === null) {
      throw new Error("invoice was missing");
    }
    expect(readString(invoice, "id")).toBe(id);
    expect(readString(invoice, "status")).toBe("uploaded");
    const file = await fetch(`${app.baseUrl}/api/invoices/${id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await file.arrayBuffer()).equals(part.bytes)).toBe(true);
    const removed = await fetch(`${app.baseUrl}/api/invoices/${id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toEqual({ success: true });
    const left = await app.pool.query("SELECT id FROM invoices WHERE id = $1", [id]);
    expect(left.rowCount).toBe(0);
    await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await fetch(`${app.baseUrl}/api/invoices/not-a-uuid`)).status).toBe(404);
    expect((await fetch(`${app.baseUrl}/api/invoices/${missing}`)).status).toBe(404);
    expect((await fetch(`${app.baseUrl}/api/invoices/not-a-uuid/file`)).status).toBe(404);
    const denied = await fetch(`${app.baseUrl}/api/invoices/not-a-uuid`, { method: "DELETE" });
    expect(denied.status).toBe(404);
    await expect(denied.json()).resolves.toEqual({ error: "not_found" });
  });

  it("returns 202 and keeps the uploaded invoice when publish throws", async () => {
    const app = current();
    const before = app.published.length;
    const part = { bytes: pdfBytes(), mime: "application/pdf", filename: "broker.pdf" };
    app.setRejectPublish(true);
    try {
      const id = await acceptedDespiteBroker(app, part);
      app.createdIds.push(id);
      await expectUploadedFile(app, id, part.bytes);
      await expectUnpublishedOutbox(app, id);
    } finally {
      app.setRejectPublish(false);
    }
    expect(app.published).toHaveLength(before);
  });

  it("does not return bytes stored outside the uploads root", async () => {
    const app = current();
    const sentinelPath = path.join(path.dirname(app.uploadsRoot), `sentinel-${randomUUID()}.txt`);
    sentinel = sentinelPath;
    const payload = Buffer.from("SENTINEL-OUTSIDE");
    await writeFile(sentinelPath, payload);
    const absoluteId = await insertOutside(app, sentinelPath);
    const dotted = `${app.uploadsRoot}${path.sep}..${path.sep}${path.basename(sentinelPath)}`;
    const dottedId = await insertOutside(app, dotted);
    await expectHidden(app, absoluteId);
    await expectHidden(app, dottedId);
    expect(await readFile(sentinelPath)).toEqual(payload);
  });
});

async function acceptedDespiteBroker(app: RunningUploadTest, part: UploadPart): Promise<string> {
  const response = await postFile(app.baseUrl, part);
  expect(response.status).toBe(202);
  const body = await readRecord(response);
  expect(readString(body, "filename")).toBe(part.filename);
  expect(readString(body, "status")).toBe("uploaded");
  return readString(body, "id");
}

async function expectUploadedFile(app: RunningUploadTest, id: string, bytes: Buffer): Promise<void> {
  const selected = await app.pool.query<{ status: string; file_path: string }>(
    "SELECT status, file_path FROM invoices WHERE id = $1",
    [id],
  );
  const row = selected.rows[0];
  if (row === undefined) {
    throw new Error("uploaded invoice row was missing");
  }
  expect(row.status).toBe("uploaded");
  expect((await readFile(row.file_path)).equals(bytes)).toBe(true);
}

async function expectUnpublishedOutbox(app: RunningUploadTest, id: string): Promise<void> {
  const selected = await app.pool.query<{ published_at: Date | null }>(
    "SELECT published_at FROM invoice_outbox WHERE invoice_id = $1",
    [id],
  );
  expect(selected.rows).toHaveLength(1);
  expect(selected.rows[0]?.published_at).toBeNull();
}

async function insertOutside(ctx: RunningUploadTest, filePath: string): Promise<string> {
  const result = await ctx.pool.query<{ id: string }>(
    `INSERT INTO invoices (filename, original_name, mime_type, file_size, file_path)
     VALUES ('outside.txt', 'outside.txt', 'text/plain', 16, $1)
     RETURNING id`,
    [filePath],
  );
  const id = result.rows[0]?.id;
  if (typeof id !== "string") {
    throw new Error("outside invoice id was missing");
  }
  ctx.createdIds.push(id);
  return id;
}

async function expectHidden(ctx: RunningUploadTest, id: string): Promise<void> {
  const response = await fetch(`${ctx.baseUrl}/api/invoices/${id}/file`);
  expect([400, 404]).toContain(response.status);
  expect(await response.text()).not.toContain("SENTINEL-OUTSIDE");
}
