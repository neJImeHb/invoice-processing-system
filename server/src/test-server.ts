import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import type { Pool } from "pg";
import type { ChatRunner } from "./agent/chat-turn.js";
import { createApp, unconfiguredPublisher, type AppDependencies, type InvoicePublisher } from "./app.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { postgresProbe } from "./db/probes.js";
import { createKafka } from "./kafka/client.js";
import { startInvoiceConsumer } from "./kafka/consumer.js";
import { kafkaProbe } from "./kafka/probes.js";
import { ensureInvoiceTopic } from "./kafka/topic.js";
import type { InvoiceEmbedder } from "./services/embedder.js";
import type { InvoiceExtractor } from "./services/extractor.js";
import { createSseHub, type SseHub } from "./services/sse.js";

export function createTestServer(dependencies: AppDependencies): Express {
  return createApp(dependencies);
}

export interface BootTestAppOptions {
  readonly databaseUrl: string;
  readonly kafkaBrokers: string;
  readonly uploadsRoot?: string;
  readonly publisher?: InvoicePublisher;
  readonly extractor?: InvoiceExtractor;
  readonly embedder?: InvoiceEmbedder;
  readonly chat?: ChatRunner;
}

export interface BootedTestApp {
  readonly app: Express;
  readonly pool: Pool;
  readonly sse: SseHub;
  heartbeatCount(): number;
  shutdown(): Promise<void>;
}

interface Stoppable {
  stop(): Promise<void>;
  heartbeatCount(): number;
}

interface WorkerPair {
  readonly extractor: InvoiceExtractor;
  readonly embedder: InvoiceEmbedder;
}

export async function bootTestApp(options: BootTestAppOptions): Promise<BootedTestApp> {
  const workers = workerPair(options.extractor, options.embedder);
  const pool = createPool(options.databaseUrl);
  const sse = createSseHub();
  let consumer: Stoppable | undefined;
  try {
    const kafka = createKafka(options.kafkaBrokers);
    await migrate(pool);
    await ensureInvoiceTopic(kafka);
    const uploadsRoot = await ensureUploadsRoot(options.uploadsRoot);
    if (workers !== undefined) {
      consumer = await startInvoiceConsumer({
        kafka,
        pool,
        sse,
        extractor: workers.extractor,
        embedder: workers.embedder,
        uploadsRoot,
      });
    }
    return startedApp(options, pool, sse, uploadsRoot, kafka, consumer);
  } catch (error) {
    await stopQuietly(consumer);
    sse.close();
    await closePool(pool);
    throw error;
  }
}

function startedApp(
  options: BootTestAppOptions,
  pool: Pool,
  sse: SseHub,
  uploadsRoot: string,
  kafka: ReturnType<typeof createKafka>,
  consumer: Stoppable | undefined,
): BootedTestApp {
  return {
    app: createApp({
      postgres: postgresProbe(pool),
      kafka: kafkaProbe(kafka),
      pool,
      uploadsRoot,
      publisher: options.publisher ?? unconfiguredPublisher(),
      sse,
      chat: options.chat,
    }),
    pool,
    sse,
    heartbeatCount(): number {
      if (consumer === undefined) {
        return 0;
      }
      return consumer.heartbeatCount();
    },
    shutdown(): Promise<void> {
      return shutdownBoot(consumer, sse, pool);
    },
  };
}

function workerPair(
  extractor: InvoiceExtractor | undefined,
  embedder: InvoiceEmbedder | undefined,
): WorkerPair | undefined {
  if (extractor === undefined && embedder === undefined) {
    return undefined;
  }
  if (extractor === undefined || embedder === undefined) {
    throw new Error("Invoice extractor and embedder must both be set");
  }
  return { extractor, embedder };
}

async function shutdownBoot(consumer: Stoppable | undefined, sse: SseHub, pool: Pool): Promise<void> {
  try {
    await consumer?.stop();
  } finally {
    sse.close();
    await pool.end();
  }
}

async function stopQuietly(consumer: Stoppable | undefined): Promise<void> {
  if (consumer === undefined) {
    return;
  }
  try {
    await consumer.stop();
  } catch (stopError) {
    console.error(stopError);
  }
}

async function ensureUploadsRoot(override: string | undefined): Promise<string> {
  const root = override ?? path.join(os.tmpdir(), "uploads");
  await mkdir(root, { recursive: true });
  return root;
}

async function closePool(pool: Pool): Promise<void> {
  try {
    await pool.end();
  } catch (endError) {
    // Keep the boot error visible if closing the pool also fails.
    console.error(endError);
  }
}
