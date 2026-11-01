import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { openEventStream } from "./event-stream.js";
import { type CapturedJob } from "./job-log.js";
import { insertRetryRow, postRetry, readRetryRow, type RetryApp, type SeededInvoice } from "./retry-support.js";
import { type RetrySuite } from "./retry-suite.js";
import { delay } from "./upload-event-support.js";

const FAILED_ERROR = "extractor exploded";
const PREVIOUS_ERROR = "previous failure";
const NOT_FAILED = ["completed", "processing", "uploaded"] as const;
const EVENT_KEYS = ["eventId", "filePath", "invoiceId", "mimeType", "timestamp", "type"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export async function expectSingleRetry(suite: RetrySuite): Promise<void> {
  const stream = await openEventStream(`${suite.live.baseUrl}/api/events/invoices`);
  try {
    const seed = await track(suite.live, "failed", FAILED_ERROR, suite.ids);
    const response = await postRetry(suite.live.baseUrl, seed.id);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, status: "uploaded" });
    const row = await readRetryRow(suite.live.pool, seed.id);
    expect(row.status).toBe("uploaded");
    expect(row.errorMessage).toBeNull();
    expect(row.retryCount).toBe(1);
    const record = await suite.jobs.waitFor(seed.id, 20_000);
    expectProcessEvent(record, seed);
    expect(suite.jobs.count(seed.id)).toBe(1);
    const event = await stream.waitFor("INVOICE_STATUS_CHANGED", seed.id, 10_000);
    expect(event.status).toBe("uploaded");
    expect(event.errorMessage).toBeNull();
    expect(event.updatedAt).toBe(row.updatedAt);
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  } finally {
    await stream.stop();
  }
}

export async function expectRejectedStatuses(suite: RetrySuite): Promise<void> {
  const callsBefore = suite.recorded.calls().length;
  for (const status of NOT_FAILED) {
    const seed = await track(suite.conflicts, status, null, suite.ids);
    const before = await readRetryRow(suite.conflicts.pool, seed.id);
    const response = await postRetry(suite.conflicts.baseUrl, seed.id);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "invoice_not_failed", status });
    expect(await readRetryRow(suite.conflicts.pool, seed.id)).toEqual(before);
  }
  expect(suite.recorded.calls().length).toBe(callsBefore);
}

export async function expectUnknownId(suite: RetrySuite): Promise<void> {
  const callsBefore = suite.recorded.calls().length;
  const missing = await postRetry(suite.conflicts.baseUrl, randomUUID());
  expect(missing.status).toBe(404);
  await expect(missing.json()).resolves.toEqual({ error: "not_found" });
  const malformed = await postRetry(suite.conflicts.baseUrl, "not-a-uuid");
  expect(malformed.status).toBe(404);
  await expect(malformed.json()).resolves.toEqual({ error: "not_found" });
  expect(suite.recorded.calls().length).toBe(callsBefore);
}

export async function expectParallelRetry(suite: RetrySuite): Promise<void> {
  const seed = await track(suite.live, "failed", FAILED_ERROR, suite.ids);
  const responses = await Promise.all([
    postRetry(suite.live.baseUrl, seed.id),
    postRetry(suite.live.baseUrl, seed.id),
  ]);
  const statuses = responses.map((response) => response.status).sort((left, right) => left - right);
  expect(statuses).toEqual([200, 409]);
  const bodies = await Promise.all(responses.map(async (response) => response.json()));
  expect(bodies).toContainEqual({ success: true, status: "uploaded" });
  expect(bodies).toContainEqual({ error: "invoice_not_failed", status: "uploaded" });
  const row = await readRetryRow(suite.live.pool, seed.id);
  expect(row.status).toBe("uploaded");
  expect(row.errorMessage).toBeNull();
  expect(row.retryCount).toBe(1);
  await suite.jobs.waitFor(seed.id, 20_000);
  await delay(1_000);
  expect(suite.jobs.count(seed.id)).toBe(1);
}

export async function expectKeptRetry(suite: RetrySuite): Promise<void> {
  const seed = await track(suite.broken, "failed", PREVIOUS_ERROR, suite.ids);
  const stream = await openEventStream(`${suite.broken.baseUrl}/api/events/invoices`);
  try {
    const response = await postRetry(suite.broken.baseUrl, seed.id);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, status: "uploaded" });
    const row = await readRetryRow(suite.broken.pool, seed.id);
    expect(row.status).toBe("uploaded");
    expect(row.errorMessage).toBeNull();
    expect(row.retryCount).toBe(seed.retryCount + 1);
    const event = await stream.waitFor("INVOICE_STATUS_CHANGED", seed.id, 10_000);
    expect(event.status).toBe("uploaded");
    expect(event.errorMessage).toBeNull();
    expect(event.updatedAt).toBe(row.updatedAt);
    const outbox = await suite.broken.pool.query<{ published_at: Date | null }>(
      "SELECT published_at FROM invoice_outbox WHERE invoice_id = $1",
      [seed.id],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]?.published_at).toBeNull();
  } finally {
    await stream.stop();
  }
}

async function track(
  app: RetryApp,
  status: "failed" | "completed" | "processing" | "uploaded",
  errorMessage: string | null,
  ids: string[],
): Promise<SeededInvoice> {
  const seed = await insertRetryRow(app.pool, status, errorMessage);
  ids.push(seed.id);
  return seed;
}

function expectProcessEvent(record: CapturedJob, seed: SeededInvoice): void {
  expect(record.key).toBe(seed.id);
  expect(record.fields["invoiceId"]).toBe(seed.id);
  expect(record.fields["filePath"]).toBe(seed.filePath);
  expect(record.fields["mimeType"]).toBe(seed.mimeType);
  expect(record.fields["eventId"]).toEqual(expect.stringMatching(UUID));
  expect(record.fields["timestamp"]).toEqual(expect.stringMatching(ISO));
  expect(Object.keys(record.fields).sort()).toEqual(EVENT_KEYS);
}
