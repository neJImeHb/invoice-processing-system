delete process.env.GEMINI_API_KEY;

import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findInvoiceById } from "../src/db/invoices.js";
import { createKafka } from "../src/kafka/client.js";
import { createKafkaPublisher, type KafkaPublisher } from "../src/kafka/producer.js";
import type { InvoiceEmbedder } from "../src/services/embedder.js";
import { createFakeEmbedder, createFakeExtractor, type FakeEmbedder, type FakeExtractor } from "../src/services/fakes.js";
import { completeInvoice } from "../src/services/pipeline.js";
import { createSseHub } from "../src/services/sse.js";
import { transitionInvoice } from "../src/services/transitions.js";
import { bootTestApp, type BootedTestApp } from "../src/test-server.js";
import { waitForConsumerIdle } from "./consumer-idle.js";
import { openEventStream } from "./event-stream.js";
import { closeServer, composeUp, databaseUrl, kafkaBrokers, listen } from "./health-support.js";
import { chunkReport, processingInvoice, readDetail, watchGoogle } from "./pipeline-support.js";
import { uploadPdf, delay } from "./upload-event-support.js";

const google = watchGoogle();

describe("invoice pipeline", () => {
  let server: Server | undefined;
  let booted: BootedTestApp | undefined;
  let publisher: KafkaPublisher | undefined;
  let extractor: FakeExtractor | undefined;
  let embedder: FakeEmbedder | undefined;
  let uploadsRoot = "";
  let baseUrl = "";
  const createdIds: string[] = [];

  beforeAll(async () => {
    await composeUp();
    uploadsRoot = await mkdtemp(path.join(os.tmpdir(), "invoice-us005-"));
    const kafka = createKafka(kafkaBrokers);
    publisher = createKafkaPublisher(kafka);
    extractor = createFakeExtractor();
    embedder = createFakeEmbedder();
    booted = await bootTestApp({
      databaseUrl,
      kafkaBrokers,
      uploadsRoot,
      publisher,
      extractor,
      embedder,
    });
    const started = await listen(booted.app);
    server = started.server;
    baseUrl = started.url;
    await waitForConsumerIdle(kafka);
  });

  afterAll(async () => {
    try {
      if (server !== undefined) {
        server.closeAllConnections();
        await closeServer(server);
      }
      if (booted !== undefined && createdIds.length > 0) {
        await booted.pool.query("DELETE FROM invoices WHERE id = ANY($1::uuid[])", [createdIds]);
      }
      await publisher?.disconnect();
      if (uploadsRoot.length > 0) {
        await rm(uploadsRoot, { recursive: true, force: true });
      }
    } finally {
      google.restore();
      await booted?.shutdown();
    }
  });

  it("moves an upload from processing to completed with 768-d chunks", async () => {
    const current = requiredBoot(booted);
    const callsBefore = requiredExtractor(extractor).calls;
    const embedsBefore = requiredEmbedder(embedder).calls;
    const stream = await openEventStream(`${baseUrl}/api/events/invoices`);
    try {
      const id = await uploadPdf(baseUrl, "pipeline.pdf");
      createdIds.push(id);
      await stream.waitForText(statusNeedle(id, "processing"), 30_000);
      await stream.waitForText(statusNeedle(id, "completed"), 30_000);
      const detail = await readDetail(baseUrl, id);
      expect(detail.chunksCount).toBeGreaterThan(0);
      expect(detail.normalizedText.length).toBeGreaterThan(0);
      expect(detail.invoiceNumber).toBe("INV-100");
      expect(await chunkReport(current.pool, id)).toEqual({
        count: detail.chunksCount,
        dimsOk: detail.chunksCount,
        content: detail.normalizedText,
      });
      expect(requiredExtractor(extractor).calls).toBe(callsBefore + 1);
      expect(requiredEmbedder(embedder).calls).toBe(embedsBefore + detail.chunksCount);
      expect(google.calls()).toBe(0);
      expect(process.env.GEMINI_API_KEY).toBeUndefined();
    } finally {
      await stream.stop();
    }
  });

  it("does not transition a completed invoice from uploaded and emits no SSE", async () => {
    const current = requiredBoot(booted);
    const stream = await openEventStream(`${baseUrl}/api/events/invoices`);
    try {
      const id = await uploadPdf(baseUrl, "second.pdf");
      createdIds.push(id);
      await stream.waitForText(statusNeedle(id, "completed"), 30_000);
      const before = stream.text();
      const again = await transitionInvoice(current.pool, id, "uploaded", "processing", {});
      expect(again).toBeUndefined();
      await delay(500);
      expect(stream.text().slice(before.length).includes(id)).toBe(false);
    } finally {
      await stream.stop();
    }
  });

  it("rolls back a short embedding and leaves the invoice uncompleted", async () => {
    const current = requiredBoot(booted);
    const row = await processingInvoice(current.pool, uploadsRoot, (id) => {
      createdIds.push(id);
    });
    const sse = createSseHub();
    try {
      await expect(
        completeInvoice(
          {
            pool: current.pool,
            sse,
            extractor: createFakeExtractor(),
            embedder: shortEmbedder(),
            uploadsRoot,
          },
          row,
        ),
      ).rejects.toThrow(/768/);
    } finally {
      sse.close();
    }
    const after = await findInvoiceById(current.pool, row.id);
    expect(after?.status).toBe("processing");
    expect(after?.extracted_data).toBeNull();
    expect((await chunkReport(current.pool, row.id)).count).toBe(0);
    expect(google.calls()).toBe(0);
  });
});

function statusNeedle(invoiceId: string, status: string): string {
  return `"invoiceId":"${invoiceId}","status":"${status}"`;
}

function shortEmbedder(): InvoiceEmbedder {
  return {
    embed(): Promise<readonly number[]> {
      return Promise.resolve([0.1, 0.2, 0.3]);
    },
  };
}

function requiredBoot(value: BootedTestApp | undefined): BootedTestApp {
  if (value === undefined) {
    throw new Error("pipeline app was not started");
  }
  return value;
}

function requiredExtractor(value: FakeExtractor | undefined): FakeExtractor {
  if (value === undefined) {
    throw new Error("fake extractor was not started");
  }
  return value;
}

function requiredEmbedder(value: FakeEmbedder | undefined): FakeEmbedder {
  if (value === undefined) {
    throw new Error("fake embedder was not started");
  }
  return value;
}
