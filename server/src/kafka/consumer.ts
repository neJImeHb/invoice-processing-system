import type { Consumer, EachMessagePayload, Kafka } from "kafkajs";
import type { InvoiceEmbedder } from "../services/embedder.js";
import type { InvoiceExtractor } from "../services/extractor.js";
import type { SseHub } from "../services/sse.js";
import { handleInvoiceMessage, type InvoiceConsumerDeps } from "./process-job.js";
import { INVOICE_JOBS_TOPIC } from "./topic.js";

export const INVOICE_WORKER_GROUP = "invoice-processing-workers";
export const INVOICE_SESSION_TIMEOUT_MS = 45_000;
export const INVOICE_HEARTBEAT_INTERVAL_MS = 500;
// A force-killed worker stays in the group until its session expires.
// verify starts the next Playwright server immediately, so join must outwait that.
const JOIN_TIMEOUT_MS = INVOICE_SESSION_TIMEOUT_MS + 20_000;

export interface InvoiceWorkerDeps {
  readonly kafka: Kafka;
  readonly pool: InvoiceConsumerDeps["pool"];
  readonly sse: SseHub;
  readonly extractor: InvoiceExtractor;
  readonly embedder: InvoiceEmbedder;
  readonly uploadsRoot: string;
}

export interface InvoiceConsumerHandle {
  stop(): Promise<void>;
  heartbeatCount(): number;
}

interface HeartbeatTally {
  count: number;
}

export async function startInvoiceConsumer(deps: InvoiceWorkerDeps): Promise<InvoiceConsumerHandle> {
  const beats: HeartbeatTally = { count: 0 };
  const consumer = deps.kafka.consumer({
    groupId: INVOICE_WORKER_GROUP,
    sessionTimeout: INVOICE_SESSION_TIMEOUT_MS,
    heartbeatInterval: INVOICE_HEARTBEAT_INTERVAL_MS,
  });
  await consumer.connect();
  try {
    await subscribeAndJoin(deps, consumer, beats);
    return consumerHandle(consumer, beats);
  } catch (error) {
    await stopConsumer(consumer);
    throw error;
  }
}

async function subscribeAndJoin(
  deps: InvoiceWorkerDeps,
  consumer: Consumer,
  beats: HeartbeatTally,
): Promise<void> {
  await consumer.subscribe({ topic: INVOICE_JOBS_TOPIC, fromBeginning: false });
  const joined = waitForGroupJoin(consumer);
  await consumer.run({
    autoCommit: false,
    partitionsConsumedConcurrently: 1,
    eachMessage: (payload) =>
      runWithHeartbeat(beats, payload, () => handleInvoiceMessage(deps, consumer, payload)),
  });
  await joined;
}

function consumerHandle(consumer: Consumer, beats: HeartbeatTally): InvoiceConsumerHandle {
  return {
    stop(): Promise<void> {
      return stopConsumer(consumer);
    },
    heartbeatCount(): number {
      return beats.count;
    },
  };
}

async function runWithHeartbeat(
  beats: HeartbeatTally,
  payload: EachMessagePayload,
  work: () => Promise<void>,
): Promise<void> {
  const timer = setInterval(() => {
    void beat(beats, payload);
  }, INVOICE_HEARTBEAT_INTERVAL_MS);
  try {
    await work();
  } finally {
    clearInterval(timer);
  }
}

async function beat(beats: HeartbeatTally, payload: EachMessagePayload): Promise<void> {
  beats.count += 1;
  try {
    await payload.heartbeat();
  } catch (error) {
    console.error(error);
  }
}

function waitForGroupJoin(consumer: Consumer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(() => {
        reject(new Error("Invoice consumer group did not join"));
      });
    }, JOIN_TIMEOUT_MS);
    const finish = (settle: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      settle();
    };
    consumer.on(consumer.events.GROUP_JOIN, () => {
      finish(resolve);
    });
    consumer.on(consumer.events.CRASH, (event) => {
      if (!event.payload.restart) {
        finish(() => {
          reject(event.payload.error);
        });
      }
    });
  });
}

async function stopConsumer(consumer: Consumer): Promise<void> {
  await consumer.stop();
  await consumer.disconnect();
}
