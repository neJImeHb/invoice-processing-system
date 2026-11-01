delete process.env.GEMINI_API_KEY;

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInvoiceId } from "../src/db/invoices.js";
import { bootChatHarness, checkpointRows, type ChatHarness } from "./chat-harness.js";
import { countField, metaThreadId, postChat, readSseFrames, toolEnd } from "./chat-frames.js";
import { countInvoices } from "./tools-oracle.js";

const STATISTICS_PROMPT = "Скільки всього завантажено інвойсів та які їхні статуси?";

describe("chat statistics stream", () => {
  let harness: ChatHarness | undefined;

  beforeAll(async () => {
    harness = await bootChatHarness();
  }, 180_000);

  afterAll(async () => {
    await harness?.shutdown();
  });

  it("streams statistics that match SQL and keeps the thread", async () => {
    const started = requiredHarness(harness);
    const response = await postChat(started.baseUrl, { message: STATISTICS_PROMPT });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const frames = readSseFrames(await response.text());
    expect(frames[0]?.event).toBe("meta");
    const threadId = metaThreadId(frames[0]);
    expect(parseInvoiceId(threadId)).toBe(threadId);
    const ended = toolEnd(frames, "get_invoice_statistics_and_list");
    const counts = await countInvoices(started.pool);
    expect(countField(ended.result, "total_count")).toBe(counts.total_count);
    expect(countField(ended.result, "uploaded_count")).toBe(counts.uploaded_count);
    expect(countField(ended.result, "processing_count")).toBe(counts.processing_count);
    expect(countField(ended.result, "completed_count")).toBe(counts.completed_count);
    expect(countField(ended.result, "failed_count")).toBe(counts.failed_count);
    expect(frames.some((frame) => frame.event === "done")).toBe(true);
    const again = await postChat(started.baseUrl, { message: "continue", threadId });
    expect(again.status).toBe(200);
    const againFrames = readSseFrames(await again.text());
    expect(againFrames[0]?.event).toBe("meta");
    expect(metaThreadId(againFrames[0])).toBe(threadId);
    expect(await checkpointRows(started.pool, threadId)).toBeGreaterThan(0);
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });

  it("rejects a thread id that is not a uuid and writes no checkpoint", async () => {
    const started = requiredHarness(harness);
    const before = await checkpointRows(started.pool, "not-a-uuid");
    const response = await postChat(started.baseUrl, { message: "hello", threadId: "not-a-uuid" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_thread_id" });
    expect(response.headers.get("content-type")).not.toContain("text/event-stream");
    expect(await checkpointRows(started.pool, "not-a-uuid")).toBe(before);
  });

  it("rejects a blank message", async () => {
    const started = requiredHarness(harness);
    const response = await postChat(started.baseUrl, { message: "   " });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "empty_message" });
  });
});

function requiredHarness(harness: ChatHarness | undefined): ChatHarness {
  if (harness === undefined) {
    throw new Error("chat harness was not started");
  }
  return harness;
}
