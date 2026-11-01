import type { Consumer, EachMessagePayload, Kafka } from "kafkajs";

const APP_CONSUMER_GROUP = "invoice-processing-workers";

export interface CapturedJob {
  readonly key: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface JobLog {
  waitFor(invoiceId: string, timeoutMs: number): Promise<CapturedJob>;
  count(invoiceId: string): number;
  disconnect(): Promise<void>;
}

interface RunGate {
  silenced: boolean;
}

export async function startJobLog(kafka: Kafka, groupId: string): Promise<JobLog> {
  if (groupId === APP_CONSUMER_GROUP) {
    throw new Error("The app consumer group must not be started");
  }
  const consumer = kafka.consumer({ groupId });
  const records: CapturedJob[] = [];
  const waiters = new Set<() => void>();
  const gate: RunGate = { silenced: false };
  await consumer.connect();
  await consumer.subscribe({ topic: "invoice-jobs", fromBeginning: true });
  watchConsumer(consumer, records, waiters, gate);
  return {
    waitFor(invoiceId: string, timeoutMs: number): Promise<CapturedJob> {
      return waitForJob(records, waiters, invoiceId, timeoutMs);
    },
    count(invoiceId: string): number {
      return countJobs(records, invoiceId);
    },
    async disconnect(): Promise<void> {
      gate.silenced = true;
      await consumer.disconnect();
    },
  };
}

function watchConsumer(
  consumer: Consumer,
  records: CapturedJob[],
  waiters: Set<() => void>,
  gate: RunGate,
): void {
  const running = consumer.run({
    eachMessage({ message }): Promise<void> {
      remember(message, records, waiters);
      return Promise.resolve();
    },
  });
  running.catch((error: unknown) => {
    if (!gate.silenced) {
      console.error(error);
    }
  });
}

function remember(
  message: EachMessagePayload["message"],
  records: CapturedJob[],
  waiters: Set<() => void>,
): void {
  const job = readJob(message);
  if (job === undefined) {
    return;
  }
  records.push(job);
  for (const wake of [...waiters]) {
    wake();
  }
}

function countJobs(records: readonly CapturedJob[], invoiceId: string): number {
  return records.filter((record) => record.key === invoiceId).length;
}

function waitForJob(
  records: CapturedJob[],
  waiters: Set<() => void>,
  invoiceId: string,
  timeoutMs: number,
): Promise<CapturedJob> {
  const existing = records.find((record) => record.key === invoiceId);
  if (existing !== undefined) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(wake);
      reject(new Error(`timed out waiting for kafka record ${invoiceId}`));
    }, timeoutMs);
    const wake = (): void => {
      const match = records.find((record) => record.key === invoiceId);
      if (match === undefined) {
        return;
      }
      clearTimeout(timer);
      waiters.delete(wake);
      resolve(match);
    };
    waiters.add(wake);
  });
}

function readJob(message: EachMessagePayload["message"]): CapturedJob | undefined {
  if (message.key === null || message.value === null) {
    return undefined;
  }
  const fields = parseFields(message.value.toString("utf8"));
  if (fields === undefined) {
    return undefined;
  }
  return { key: message.key.toString("utf8"), fields };
}

function parseFields(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
