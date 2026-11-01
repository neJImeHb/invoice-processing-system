delete process.env.GEMINI_API_KEY;

import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKafka } from "../src/kafka/client.js";
import { createKafkaPublisher, type KafkaPublisher } from "../src/kafka/producer.js";
import { bootTestApp, type BootedTestApp } from "../src/test-server.js";
import { openEventStream, type EventStream } from "./event-stream.js";
import { closeServer, composeUp, databaseUrl, kafkaBrokers, listen } from "./health-support.js";
import { startJobLog, type JobLog } from "./job-log.js";
import { pdfBytes } from "./upload-bytes.js";
import { readRecord, readString } from "./upload-assertions.js";
import { bootRejectingPublisher, countUnder, storedPath, uploadPdf, type RejectingApp } from "./upload-event-support.js";
import { postFile } from "./upload-harness.js";

const eventKeys = ["eventId", "filePath", "invoiceId", "mimeType", "timestamp", "type"];

describe("invoice upload events", () => {
  let server: Server | undefined;
  let booted: BootedTestApp | undefined;
  let publisher: KafkaPublisher | undefined;
  let jobs: JobLog | undefined;
  let uploadsRoot = "";
  let baseUrl = "";
  const createdIds: string[] = [];

  beforeAll(async () => {
    await composeUp();
    uploadsRoot = await mkdtemp(path.join(os.tmpdir(), "invoice-us004-"));
    const kafka = createKafka(kafkaBrokers);
    publisher = createKafkaPublisher(kafka);
    booted = await bootTestApp({ databaseUrl, kafkaBrokers, uploadsRoot, publisher });
    const started = await listen(booted.app);
    server = started.server;
    baseUrl = started.url;
    jobs = await startJobLog(kafka, `us004-${randomUUID()}`);
  }, 180_000);

  afterAll(async () => {
    try {
      await jobs?.disconnect();
      await publisher?.disconnect();
      if (server !== undefined) {
        server.closeAllConnections();
        await closeServer(server);
      }
      if (booted !== undefined && createdIds.length > 0) {
        await booted.pool.query("DELETE FROM invoices WHERE id = ANY($1::uuid[])", [createdIds]);
      }
      if (uploadsRoot.length > 0) {
        await rm(uploadsRoot, { recursive: true, force: true });
      }
    } finally {
      await booted?.shutdown();
    }
  });

  it("streams INVOICE_STATUS_CHANGED for the uploaded invoice", async () => {
    const stream = await openEventStream(`${baseUrl}/api/events/invoices`);
    try {
      expect(stream.header("content-type")).toBe("text/event-stream");
      expect(stream.header("cache-control")).toBe("no-cache");
      expect(stream.header("x-accel-buffering")).toBe("no");
      const id = await uploadPdf(baseUrl, "queued.pdf");
      createdIds.push(id);
      const event = await stream.waitFor("INVOICE_STATUS_CHANGED", id, 10_000);
      expect(event.invoiceId).toBe(id);
      expect(event.status).toBe("uploaded");
      expect(event.errorMessage).toBeNull();
      expect(event.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(process.env.GEMINI_API_KEY).toBeUndefined();
    } finally {
      await stream.stop();
    }
  });

  it("streams INVOICE_DELETED and the file is gone", async () => {
    const pool = requiredBoot(booted).pool;
    const id = await uploadPdf(baseUrl, "gone.pdf");
    createdIds.push(id);
    const filePath = await storedPath(pool, id);
    const stream = await openEventStream(`${baseUrl}/api/events/invoices`);
    try {
      const removed = await fetch(`${baseUrl}/api/invoices/${id}`, { method: "DELETE" });
      expect(removed.status).toBe(200);
      const event = await stream.waitFor("INVOICE_DELETED", id, 10_000);
      expect(event.invoiceId).toBe(id);
      await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await stream.stop();
    }
  });

  it("writes one invoice-jobs record with the section 4.4 keys", async () => {
    const id = await uploadPdf(baseUrl, "job.pdf");
    createdIds.push(id);
    const record = await requiredJobs(jobs).waitFor(id, 20_000);
    expect(record.key).toBe(id);
    expect(record.fields["invoiceId"]).toBe(id);
    expect(record.fields["type"]).toBe("PROCESS_INVOICE");
    expect(Object.keys(record.fields).sort()).toEqual(eventKeys);
    expect(Object.hasOwn(record.fields, "originalName")).toBe(false);
  });

  it("receives a ping comment within 20 seconds", async () => {
    const stream = await openEventStream(`${baseUrl}/api/events/invoices`);
    try {
      await stream.waitForText(": ping\n", 20_000);
    } finally {
      await stream.stop();
    }
  });

  it("returns 202 and emits uploaded when publish throws", async () => {
    const failing = await bootRejectingPublisher(databaseUrl, kafkaBrokers);
    const stream = await openEventStream(`${failing.baseUrl}/api/events/invoices`);
    let id: string | undefined;
    try {
      const response = await postFile(failing.baseUrl, {
        bytes: pdfBytes(),
        mime: "application/pdf",
        filename: "broker.pdf",
      });
      expect(response.status).toBe(202);
      const body = await readRecord(response);
      id = readString(body, "id");
      expect(readString(body, "status")).toBe("uploaded");
      const event = await stream.waitFor("INVOICE_STATUS_CHANGED", id, 10_000);
      expect(event.status).toBe("uploaded");
      expect(await readdir(failing.uploadsRoot)).not.toEqual([]);
      expect(await countUnder(failing.pool, failing.uploadsRoot)).toBe(1);
    } finally {
      await closeFailingUpload(stream, failing, id);
    }
  });
});

async function closeFailingUpload(stream: EventStream, failing: RejectingApp, id: string | undefined): Promise<void> {
  try {
    await stream.stop();
  } finally {
    try {
      if (id !== undefined) {
        await failing.pool.query("DELETE FROM invoices WHERE id = $1", [id]);
      }
    } finally {
      await failing.close();
    }
  }
}

function requiredBoot(value: BootedTestApp | undefined): BootedTestApp {
  if (value === undefined) {
    throw new Error("upload app was not started");
  }
  return value;
}

function requiredJobs(value: JobLog | undefined): JobLog {
  if (value === undefined) {
    throw new Error("job log was not started");
  }
  return value;
}
