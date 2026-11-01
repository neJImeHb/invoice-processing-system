delete process.env.GEMINI_API_KEY;

import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import type { Kafka } from "kafkajs";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findInvoiceById } from "../src/db/invoices.js";
import type { ProcessInvoiceEvent } from "../src/domain/invoice-event.js";
import { createKafka } from "../src/kafka/client.js";
import { createKafkaPublisher, type KafkaPublisher } from "../src/kafka/producer.js";
import { createFakeEmbedder } from "../src/services/fakes.js";
import { bootTestApp, type BootedTestApp } from "../src/test-server.js";
import { waitForCommittedOffset, waitForConsumerIdle } from "./consumer-idle.js";
import { closeServer, composeUp, databaseUrl, kafkaBrokers, listen } from "./health-support.js";
import { chunkReport, watchGoogle } from "./pipeline-support.js";
import {
  assertDeletedDuringExtract,
  createScriptedExtractor,
  encryptedPdf,
  publishPoison,
  recordingPublisher,
  sentEvent,
  statusNeedle,
  truncatedPdf,
  uploadPdfBytes,
  withInvoiceStream,
  type RunningFailureApp,
  type ScriptedExtractor,
} from "./pipeline-failure-support.js";
import { uploadPdf } from "./upload-event-support.js";

const google = watchGoogle();
const createdIds: string[] = [];
const sent: ProcessInvoiceEvent[] = [];

describe("invoice pipeline failures", () => {
  let server: Server | undefined;
  let booted: BootedTestApp | undefined;
  let publisher: KafkaPublisher | undefined;
  let kafka: Kafka | undefined;
  let extractor: ScriptedExtractor | undefined;
  let uploadsRoot = "";
  let baseUrl = "";

  beforeAll(async () => {
    await composeUp();
    uploadsRoot = await mkdtemp(path.join(os.tmpdir(), "invoice-us006-"));
    kafka = createKafka(kafkaBrokers);
    publisher = recordingPublisher(createKafkaPublisher(kafka), sent);
    extractor = createScriptedExtractor();
    booted = await bootTestApp({
      databaseUrl,
      kafkaBrokers,
      uploadsRoot,
      publisher,
      extractor,
      embedder: createFakeEmbedder(),
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
      expect(google.calls()).toBe(0);
    } finally {
      google.restore();
      await booted?.shutdown();
    }
  });

  it.each([
    ["encrypted.pdf", encryptedPdf(), /encrypted/i],
    ["truncated.pdf", truncatedPdf(), /unreadable/i],
  ] as const)("fails %s without calling the extractor", async (filename, bytes, pattern) => {
    const active = running(booted, kafka, publisher, extractor);
    const calls = active.extractor.calls;
    await withInvoiceStream(baseUrl, async (stream) => {
      const id = track(await uploadPdfBytes(baseUrl, filename, bytes));
      await stream.waitForText(statusNeedle(id, "failed"), 30_000);
      expect(active.extractor.calls).toBe(calls);
      await expectFailed(active.pool, id, pattern);
    });
  });

  it("fails when the extractor throws and stores no chunks", async () => {
    const active = running(booted, kafka, publisher, extractor);
    active.extractor.mode = "throw";
    try {
      await withInvoiceStream(baseUrl, async (stream) => {
        const id = track(await uploadPdf(baseUrl, "refused.pdf"));
        await stream.waitForText(statusNeedle(id, "failed"), 30_000);
        await expectFailed(active.pool, id, /model refused/);
      });
    } finally {
      active.extractor.mode = "fixed";
    }
  });

  it("commits a poison payload and still completes a following upload", async () => {
    const active = running(booted, kafka, publisher, extractor);
    const poison = await publishPoison(active.kafka);
    await waitForCommittedOffset(active.kafka, poison.partition, poison.offset);
    await withInvoiceStream(baseUrl, async (stream) => {
      const id = track(await uploadPdf(baseUrl, "after-poison.pdf"));
      await stream.waitForText(statusNeedle(id, "completed"), 30_000);
      expect((await findInvoiceById(active.pool, id))?.status).toBe("completed");
    });
  });

  it("does not extract a completed invoice when the same payload is delivered again", async () => {
    const active = running(booted, kafka, publisher, extractor);
    await withInvoiceStream(baseUrl, async (stream) => {
      const id = track(await uploadPdf(baseUrl, "once.pdf"));
      await stream.waitForText(statusNeedle(id, "completed"), 30_000);
      const calls = active.extractor.calls;
      const chunks = (await chunkReport(active.pool, id)).count;
      await active.publisher.publish(id, sentEvent(sent, id));
      const next = track(await uploadPdf(baseUrl, "after-redelivery.pdf"));
      await stream.waitForText(statusNeedle(next, "completed"), 30_000);
      await waitForConsumerIdle(active.kafka);
      expect(active.extractor.calls).toBe(calls + 1);
      expect((await chunkReport(active.pool, id)).count).toBe(chunks);
    });
  });

  it("heartbeats and commits when the row is deleted during extraction", async () => {
    const active = running(booted, kafka, publisher, extractor);
    active.extractor.mode = "slow";
    const beats = active.booted.heartbeatCount();
    const started = new Promise<void>((resolve) => {
      active.extractor.whenSlow(resolve);
    });
    try {
      await assertDeletedDuringExtract(active, baseUrl, beats, started, track);
    } finally {
      active.extractor.mode = "fixed";
    }
  });

  it("completes when line totals do not match the grand total", async () => {
    const active = running(booted, kafka, publisher, extractor);
    active.extractor.mode = "mismatch";
    const calls = active.extractor.calls;
    try {
      await withInvoiceStream(baseUrl, async (stream) => {
        const id = track(await uploadPdf(baseUrl, "mismatch.pdf"));
        await stream.waitForText(statusNeedle(id, "completed"), 30_000);
        const row = await findInvoiceById(active.pool, id);
        expect(row?.status).toBe("completed");
        expect(row?.error_message).toBeNull();
        expect((await chunkReport(active.pool, id)).count).toBeGreaterThan(0);
        expect(active.extractor.calls).toBe(calls + 1);
      });
    } finally {
      active.extractor.mode = "fixed";
    }
  });
});

function running(
  booted: BootedTestApp | undefined,
  kafka: Kafka | undefined,
  publisher: KafkaPublisher | undefined,
  extractor: ScriptedExtractor | undefined,
): RunningFailureApp {
  if (booted === undefined || extractor === undefined || kafka === undefined || publisher === undefined) {
    throw new Error("pipeline failure app was not started");
  }
  return { pool: booted.pool, kafka, publisher, extractor, booted };
}

function track(id: string): string {
  createdIds.push(id);
  return id;
}

async function expectFailed(pool: Pool, id: string, pattern: RegExp): Promise<void> {
  const row = await findInvoiceById(pool, id);
  expect(row?.status).toBe("failed");
  expect(row?.error_message).toMatch(pattern);
  expect((await chunkReport(pool, id)).count).toBe(0);
}
