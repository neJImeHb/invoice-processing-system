import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { retryFailedInvoice } from "../src/agent/tools/retry.js";
import { searchInvoicesVector } from "../src/agent/tools/search.js";
import { prefixQuery } from "../src/services/prefixes.js";
import type { SseHub } from "../src/services/sse.js";
import { recordingPublisher } from "./retry-support.js";
import { insertToolInvoice, type ToolFixture } from "./tools-db.js";
import { namedFixture, readInvoiceSnapshot, toolDependencies, vectorInvoiceFixture } from "./tools-harness.js";
import { chunkCount, insertChunks, unitVector, vectorEmbedder } from "./tools-vector.js";

const TOOL_SOURCES = [
  "../src/agent/tools/statistics.ts",
  "../src/agent/tools/search.ts",
  "../src/agent/tools/retry.ts",
  "../src/db/statistics.ts",
] as const;

export async function expectPlantedChunk(pool: Pool, runId: string, track: (id: string) => void): Promise<void> {
  const vector = unitVector(`plant-${runId}`);
  const invoiceId = await insertToolInvoice(pool, vectorInvoiceFixture(runId));
  track(invoiceId);
  await insertChunks(pool, invoiceId, [
    { content: `decoy-${runId}`, embedding: unitVector(`decoy-${runId}`) },
    { content: `planted-${runId}`, embedding: vector },
  ]);
  const embedder = vectorEmbedder(vector);
  const query = `planted ${runId}`;
  const hits = await searchInvoicesVector(pool, embedder, { query });
  const first = hits[0];
  if (embedder.texts().join() !== prefixQuery(query)) {
    throw new Error("vector search did not embed the prefixed query");
  }
  if (
    first === undefined ||
    first.chunkText !== `planted-${runId}` ||
    first.fileName !== `vector-${runId}.pdf` ||
    first.vendor !== `Vector ${runId}` ||
    first.invoiceNumber !== "INV-US014" ||
    first.total !== "64" ||
    first.currency !== "EUR" ||
    Math.abs(first.similarity - 1) > 0.00001
  ) {
    throw new Error("planted chunk was not the first vector hit");
  }
}

export async function expectVectorLimit(pool: Pool, runId: string, track: (id: string) => void): Promise<void> {
  const vector = unitVector(`limit-${runId}`);
  const invoiceId = await insertToolInvoice(pool, vectorInvoiceFixture(`${runId}-limit`));
  track(invoiceId);
  const rows = Array.from({ length: 11 }, (_, index) => ({
    content: `cap-${String(index)}-${runId}`,
    embedding: vector,
  }));
  await insertChunks(pool, invoiceId, rows);
  const embedder = vectorEmbedder(vector);
  const capped = await searchInvoicesVector(pool, embedder, { query: "cap", limit: 50 });
  const defaults = await searchInvoicesVector(pool, embedder, { query: "cap" });
  const two = await searchInvoicesVector(pool, embedder, { query: "cap", limit: 2 });
  if (capped.length !== 10 || defaults.length !== 5 || two.length !== 2) {
    throw new Error("vector limit was not capped");
  }
}

export async function expectEmptyVectorSearch(pool: Pool): Promise<void> {
  const before = await chunkCount(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("DELETE FROM invoice_chunks");
      const hits = await searchInvoicesVector(client, vectorEmbedder(unitVector("empty")), { query: "empty" });
      if (hits.length !== 0) {
        throw new Error("empty chunk table returned hits");
      }
    } finally {
      await client.query("ROLLBACK");
    }
  } finally {
    client.release();
  }
  if ((await chunkCount(pool)) !== before) {
    throw new Error("chunk rollback did not restore committed rows");
  }
}

export async function expectRetryOutcomes(
  pool: Pool,
  sse: SseHub,
  runId: string,
  track: (id: string) => void,
): Promise<void> {
  const failed = await trackInvoice(pool, track, namedFixture("failed", `failed-retry-${runId}.pdf`, runId, 1));
  const completed = await trackInvoice(pool, track, namedFixture("completed", `done-retry-${runId}.pdf`, runId, 2));
  const only = await trackInvoice(pool, track, namedFixture("failed", `only-${runId}.pdf`, runId, 3));
  const publisher = recordingPublisher();
  const dependencies = toolDependencies(pool, publisher, sse);
  const times = (id: string): number => publisher.calls().filter((item) => item === id).length;
  const retried = await retryFailedInvoice(dependencies, { id: failed });
  if ("ids" in retried || retried.httpStatus !== 200 || !("success" in retried.body)) {
    throw new Error("failed invoice was not retried");
  }
  if (times(failed) !== 1) {
    throw new Error("retry did not publish once");
  }
  const snapshot = await readInvoiceSnapshot(pool, failed);
  if (snapshot.status !== "uploaded" || snapshot.errorMessage !== null || snapshot.retryCount !== 1) {
    throw new Error("retry did not reset the failed invoice");
  }
  const blocked = await retryFailedInvoice(dependencies, { id: completed });
  if ("ids" in blocked || blocked.httpStatus !== 409 || !("error" in blocked.body) || blocked.body.error !== "invoice_not_failed" || blocked.body.status !== "completed") {
    throw new Error("completed invoice did not return 409");
  }
  if (times(completed) !== 0 || (await readInvoiceSnapshot(pool, completed)).status !== "completed") {
    throw new Error("completed invoice was published or changed");
  }
  const byName = await retryFailedInvoice(dependencies, { original_name: `only-${runId}.pdf` });
  if ("ids" in byName || byName.httpStatus !== 200 || times(only) !== 1 || times(failed) !== 1) {
    throw new Error("single file name was not retried once");
  }
  const unknown = randomUUID();
  const missing = await retryFailedInvoice(dependencies, { id: unknown });
  if ("ids" in missing || missing.httpStatus !== 404 || !("error" in missing.body) || missing.body.error !== "not_found" || times(unknown) !== 0) {
    throw new Error("unknown id was not not_found");
  }
}

export async function expectAmbiguousName(
  pool: Pool,
  sse: SseHub,
  runId: string,
  track: (id: string) => void,
): Promise<void> {
  const name = `shared-${runId}.pdf`;
  const first = await trackInvoice(pool, track, namedFixture("failed", name, runId, 4));
  const second = await trackInvoice(pool, track, namedFixture("failed", name, runId, 5));
  const publisher = recordingPublisher();
  const result = await retryFailedInvoice(toolDependencies(pool, publisher, sse), { original_name: name });
  if (publisher.calls().length !== 0 || !("ids" in result)) {
    throw new Error("shared file name was retried");
  }
  if ([...result.ids].sort().join() !== [first, second].sort().join()) {
    throw new Error("shared file name did not return both ids");
  }
  if ((await readInvoiceSnapshot(pool, first)).status !== "failed") {
    throw new Error("first shared invoice changed");
  }
  if ((await readInvoiceSnapshot(pool, second)).status !== "failed") {
    throw new Error("second shared invoice changed");
  }
}

export async function assertToolSql(): Promise<void> {
  const sources = await Promise.all(TOOL_SOURCES.map((relative) => readSource(relative)));
  sources.forEach((source, index) => {
    assertStaticSql(source, TOOL_SOURCES[index] ?? "tool");
  });
  const tools = sources.slice(0, 3).join("\n");
  if (/langchain|GeminiEmbedder|@google\/genai|PostgresSaver|createAgent/.test(tools)) {
    throw new Error("tool files import a model or agent runtime");
  }
  const search = sources[1] ?? "";
  if (!search.includes("ORDER BY invoice_chunks.embedding <=> $1::vector")) {
    throw new Error("vector search does not order by cosine distance");
  }
  if (/ORDER BY\s+similarity/i.test(search) || /ORDER BY\s+1\s*-/.test(search)) {
    throw new Error("vector search orders by similarity");
  }
}

async function trackInvoice(pool: Pool, track: (id: string) => void, fixture: ToolFixture): Promise<string> {
  const id = await insertToolInvoice(pool, fixture);
  track(id);
  return id;
}

function readSource(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

function assertStaticSql(source: string, fileName: string): void {
  for (const match of source.matchAll(/`[^`]*`/gs)) {
    const body = match[0];
    if (/\bSELECT\b/i.test(body) && body.includes("${")) {
      throw new Error(`${fileName} interpolates a SELECT`);
    }
  }
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/\bSELECT\b/i.test(line) && (line.includes("${") || /['"`]\s*\+|\+\s*['"`]/.test(line))) {
      throw new Error(`${fileName}:${String(index + 1)} concatenates a SELECT`);
    }
  }
}
