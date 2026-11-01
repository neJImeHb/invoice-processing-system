delete process.env.GEMINI_API_KEY;

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKafka } from "../src/kafka/client.js";
import { bootChatHarness, type ChatHarness } from "./chat-harness.js";
import { postChat, readSseFrames, toolEnd } from "./chat-frames.js";
import { kafkaBrokers } from "./health-support.js";
import { startJobLog, type JobLog } from "./job-log.js";
import { insertToolInvoice } from "./tools-db.js";
import { namedFixture, readInvoiceSnapshot } from "./tools-harness.js";

describe("chat retry action", () => {
  let harness: ChatHarness | undefined;
  let jobs: JobLog | undefined;
  let invoiceId: string | undefined;

  beforeAll(async () => {
    harness = await bootChatHarness();
    jobs = await startJobLog(createKafka(kafkaBrokers), `us015-${randomUUID()}`);
  }, 180_000);

  afterAll(async () => {
    try {
      await jobs?.disconnect();
      if (harness !== undefined && invoiceId !== undefined) {
        await harness.pool.query("DELETE FROM invoices WHERE id = $1", [invoiceId]);
      }
    } finally {
      await harness?.shutdown();
    }
  });

  it("retries one failed invoice onto invoice-jobs", async () => {
    const started = requiredHarness(harness);
    const runId = randomUUID();
    invoiceId = await insertToolInvoice(
      started.pool,
      namedFixture("failed", `agent-retry-${runId}.pdf`, runId, 3),
    );
    const response = await postChat(started.baseUrl, { message: `retry ${invoiceId}` });
    expect(response.status).toBe(200);
    const frames = readSseFrames(await response.text());
    const ended = toolEnd(frames, "retry_failed_invoice");
    expect(ended.name).toBe("retry_failed_invoice");
    expect(ended.arguments).toEqual({ id: invoiceId });
    expect(ended.result).toEqual({ httpStatus: 200, body: { success: true, status: "uploaded" } });
    expect((await readInvoiceSnapshot(started.pool, invoiceId)).status).toBe("uploaded");
    const record = await requiredJobs(jobs).waitFor(invoiceId, 20_000);
    expect(record.key).toBe(invoiceId);
    expect(requiredJobs(jobs).count(invoiceId)).toBe(1);
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });
});

function requiredHarness(harness: ChatHarness | undefined): ChatHarness {
  if (harness === undefined) {
    throw new Error("chat harness was not started");
  }
  return harness;
}

function requiredJobs(jobs: JobLog | undefined): JobLog {
  if (jobs === undefined) {
    throw new Error("job log was not started");
  }
  return jobs;
}
