delete process.env.GEMINI_API_KEY;

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pdfBytes } from "./upload-bytes.js";
import { expectAccepted, readRows, readString } from "./upload-assertions.js";
import { startUploadTest, type RunningUploadTest } from "./upload-harness.js";

const FIXTURE_SQL = `INSERT INTO invoices (filename, original_name, mime_type, file_size, file_path, created_at)
  SELECT 'us003-fixture-' || g.i || '.pdf', 'us003-fixture-' || g.i || '.pdf', 'application/pdf', 1,
         'missing-' || g.i || '.pdf', TIMESTAMPTZ '5999-01-01 00:00:00+00' + make_interval(secs => g.i)
  FROM generate_series(0, 100) AS g(i)
  RETURNING id, created_at`;

describe("invoice list", () => {
  let ctx: RunningUploadTest | undefined;

  beforeAll(async () => {
    ctx = await startUploadTest();
    await ctx.pool.query(
      "DELETE FROM invoices WHERE original_name LIKE 'us003-fixture-%' OR original_name = 'us003-listed.pdf'",
    );
  }, 300_000);

  afterAll(async () => {
    if (ctx !== undefined) {
      await ctx.pool.query(
        "DELETE FROM invoices WHERE original_name LIKE 'us003-fixture-%' OR original_name = 'us003-listed.pdf'",
      );
      await ctx.cleanup();
    }
  });

  function current(): RunningUploadTest {
    if (ctx === undefined) {
      throw new Error("list test did not start");
    }
    return ctx;
  }

  it("filters by status and honors limit and offset", async () => {
    const app = current();
    const part = { bytes: pdfBytes(), mime: "application/pdf", filename: "us003-listed.pdf" };
    const pdfId = await expectAccepted(app, part, "us003-listed.pdf");
    await app.pool.query("UPDATE invoices SET created_at = $2 WHERE id = $1", [pdfId, "9999-01-01T00:00:00.000Z"]);
    const included = await readRows(await fetch(`${app.baseUrl}/api/invoices?status=uploaded&limit=1`));
    expect(readString(requiredRow(included[0]), "id")).toBe(pdfId);
    const failed = await readRows(await fetch(`${app.baseUrl}/api/invoices?status=failed&limit=100`));
    expect(failed.some((row) => readString(row, "id") === pdfId)).toBe(false);
    await app.pool.query("UPDATE invoices SET created_at = $2 WHERE id = $1", [pdfId, "2000-01-01T00:00:00.000Z"]);

    const inserted = await app.pool.query<{ id: string; created_at: Date | string }>(FIXTURE_SQL);
    const ordered = [...inserted.rows].sort((left, right) => timestamp(left.created_at) - timestamp(right.created_at));
    for (const row of ordered) {
      app.createdIds.push(row.id);
    }
    const newest = ordered.at(-1)?.id;
    const second = ordered.at(-2)?.id;
    if (newest === undefined || second === undefined) {
      throw new Error("fixture ids were missing");
    }

    const top = await readRows(await fetch(`${app.baseUrl}/api/invoices?status=uploaded&limit=1`));
    expect(readString(requiredRow(top[0]), "id")).toBe(newest);
    const skipped = await readRows(await fetch(`${app.baseUrl}/api/invoices?status=uploaded&limit=1&offset=1`));
    expect(readString(requiredRow(skipped[0]), "id")).toBe(second);
    const negative = await readRows(await fetch(`${app.baseUrl}/api/invoices?status=uploaded&limit=1&offset=-4`));
    expect(readString(requiredRow(negative[0]), "id")).toBe(newest);
    expect(await readRows(await fetch(`${app.baseUrl}/api/invoices?status=uploaded`))).toHaveLength(50);
    expect(await readRows(await fetch(`${app.baseUrl}/api/invoices?status=uploaded&limit=100`))).toHaveLength(100);
    expect(await readRows(await fetch(`${app.baseUrl}/api/invoices?status=uploaded&limit=1000`))).toHaveLength(100);
    expect(await readRows(await fetch(`${app.baseUrl}/api/invoices?status=uploaded&limit=0`))).toHaveLength(50);
    expect(await readRows(await fetch(`${app.baseUrl}/api/invoices?status=uploaded&limit=abc`))).toHaveLength(50);
    const invalid = await fetch(`${app.baseUrl}/api/invoices?status=archived`);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: "invalid_status" });
  });
});

function requiredRow(value: object | undefined): object {
  if (value === undefined) {
    throw new Error("list row was missing");
  }
  return value;
}

function timestamp(value: Date | string): number {
  const parsed = value instanceof Date ? value : new Date(value);
  return parsed.getTime();
}
