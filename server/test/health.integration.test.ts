delete process.env.GEMINI_API_KEY;

import type { Server } from "node:http";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, unconfiguredPublisher } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { createKafka } from "../src/kafka/client.js";
import { createSseHub } from "../src/services/sse.js";
import { bootTestApp } from "../src/test-server.js";
import {
  closeServer,
  composeUp,
  databaseUrl,
  kafkaBrokers,
  listen,
  probe,
  requireString,
  requireTimestamp,
} from "./health-support.js";

const testFilename = "health-us002.pdf";
const staleUpdatedAt = "2000-01-01T00:00:00.000Z";

async function expectHealth(
  postgres: boolean | "throw",
  kafka: boolean | "throw",
  expected: { status: "ok" | "degraded"; postgres: boolean; kafka: boolean },
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1, allowExitOnIdle: true });
  const sse = createSseHub();
  try {
    const started = await listen(createApp({
      postgres: probe(postgres),
      kafka: probe(kafka),
      pool,
      uploadsRoot: ".",
      publisher: unconfiguredPublisher(),
      sse,
    }));
    try {
      const response = await fetch(`${started.url}/api/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expected);
    } finally {
      await closeServer(started.server);
    }
  } finally {
    sse.close();
    await pool.end();
  }
}

describe("injected health probes", () => {
  it("degrades when a probe throws or returns false", async () => {
    await expectHealth("throw", true, { status: "degraded", postgres: false, kafka: true });
    await expectHealth(true, "throw", { status: "degraded", postgres: true, kafka: false });
    await expectHealth("throw", "throw", { status: "degraded", postgres: false, kafka: false });
    await expectHealth(false, true, { status: "degraded", postgres: false, kafka: true });
    await expectHealth(true, false, { status: "degraded", postgres: true, kafka: false });
  });
});

describe("compose health", () => {
  let server: Server | undefined;
  let pool: Pool | undefined;
  let shutdown: (() => Promise<void>) | undefined;
  let invoiceId: string | undefined;
  let healthUrl = "";

  beforeAll(async () => {
    await composeUp();
    const booted = await bootTestApp({ databaseUrl, kafkaBrokers });
    await migrate(booted.pool);
    pool = booted.pool;
    shutdown = booted.shutdown;
    const started = await listen(booted.app);
    server = started.server;
    healthUrl = started.url;
  }, 300_000);

  afterAll(async () => {
    if (pool !== undefined && invoiceId !== undefined) {
      await pool.query("DELETE FROM invoices WHERE id = $1", [invoiceId]);
    }
    if (server !== undefined) {
      await closeServer(server);
    }
    if (shutdown !== undefined) {
      await shutdown();
    }
  });

  it("returns ok when postgres and kafka are up", async () => {
    const response = await fetch(`${healthUrl}/api/health`);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual({ status: "ok", postgres: true, kafka: true });
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });

  it("ensures invoice-jobs has 3 partitions", async () => {
    const admin = createKafka(kafkaBrokers).admin();
    try {
      await admin.connect();
      const topics = await admin.listTopics();
      expect(topics).toContain("invoice-jobs");
      const metadata = await admin.fetchTopicMetadata({ topics: ["invoice-jobs"] });
      const topic = metadata.topics.find((item) => item.name === "invoice-jobs");
      expect(topic?.partitions).toHaveLength(3);
    } finally {
      await admin.disconnect();
    }
  });

  it("advances updated_at when the update omits that column", async () => {
    if (pool === undefined) {
      throw new Error("pool was not started");
    }
    const inserted = await pool.query(
      `INSERT INTO invoices (filename, original_name, mime_type, file_size, file_path)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [testFilename, testFilename, "application/pdf", 128, "uploads/health-us002.pdf"],
    );
    invoiceId = requireString(inserted.rows[0]?.id, "invoice id");
    await pool.query("ALTER TABLE invoices DISABLE TRIGGER invoices_set_updated_at");
    try {
      await pool.query("UPDATE invoices SET updated_at = $2 WHERE id = $1", [invoiceId, staleUpdatedAt]);
    } finally {
      await pool.query("ALTER TABLE invoices ENABLE TRIGGER invoices_set_updated_at");
    }
    await pool.query("UPDATE invoices SET retry_count = $2 WHERE id = $1", [invoiceId, 1]);
    const selected = await pool.query("SELECT updated_at FROM invoices WHERE id = $1", [invoiceId]);
    const updatedAt = requireTimestamp(selected.rows[0]?.updated_at);
    expect(updatedAt.getTime()).toBeGreaterThan(Date.parse(staleUpdatedAt));
  });
});
