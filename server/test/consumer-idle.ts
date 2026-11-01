import type { Admin, Kafka } from "kafkajs";
import { INVOICE_WORKER_GROUP } from "../src/kafka/consumer.js";
import { INVOICE_JOBS_TOPIC } from "../src/kafka/topic.js";

interface PartitionMark {
  readonly partition: number;
  readonly offset: string;
}

export async function waitForConsumerIdle(kafka: Kafka, timeoutMs = 120_000): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (await caughtUpTwice(admin)) {
        return;
      }
      await delay(200);
    }
  } finally {
    await admin.disconnect();
  }
  throw new Error("invoice consumer was still behind");
}

export async function waitForCommittedOffset(
  kafka: Kafka,
  partition: number,
  messageOffset: string,
  timeoutMs = 30_000,
): Promise<void> {
  const target = offsetNumber(messageOffset) + 1;
  const admin = kafka.admin();
  await admin.connect();
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (await partitionCommitted(admin, partition, target)) {
        return;
      }
      await delay(200);
    }
  } finally {
    await admin.disconnect();
  }
  throw new Error("invoice offset was not committed");
}

async function partitionCommitted(admin: Admin, partition: number, target: number): Promise<boolean> {
  try {
    const groups = await admin.fetchOffsets({
      groupId: INVOICE_WORKER_GROUP,
      topics: [INVOICE_JOBS_TOPIC],
    });
    const marks = groups.find((item) => item.topic === INVOICE_JOBS_TOPIC)?.partitions ?? [];
    const mark = marks.find((item) => item.partition === partition);
    if (mark === undefined) {
      return false;
    }
    return offsetNumber(mark.offset) >= target;
  } catch (error) {
    console.error(error);
    return false;
  }
}

async function caughtUpTwice(admin: Admin): Promise<boolean> {
  try {
    if (!(await consumerCaughtUp(admin))) {
      return false;
    }
    await delay(400);
    return await consumerCaughtUp(admin);
  } catch (error) {
    console.error(error);
    return false;
  }
}

async function consumerCaughtUp(admin: Admin): Promise<boolean> {
  const ends = await admin.fetchTopicOffsets(INVOICE_JOBS_TOPIC);
  const groups = await admin.fetchOffsets({
    groupId: INVOICE_WORKER_GROUP,
    topics: [INVOICE_JOBS_TOPIC],
  });
  const committed = groups.find((item) => item.topic === INVOICE_JOBS_TOPIC)?.partitions ?? [];
  return ends.every((entry) => partitionCaughtUp(entry.partition, entry.high, committed));
}

function partitionCaughtUp(partition: number, high: string, committed: readonly PartitionMark[]): boolean {
  const mark = committed.find((item) => item.partition === partition);
  const current = mark === undefined ? -1 : offsetNumber(mark.offset);
  if (current < 0) {
    return true;
  }
  return current >= offsetNumber(high);
}

function offsetNumber(value: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Kafka offset was not an integer: ${value}`);
  }
  return Number(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
