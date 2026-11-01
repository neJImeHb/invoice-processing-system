import { randomUUID } from "node:crypto";
import { createKafka } from "../src/kafka/client.js";
import { createKafkaPublisher, type KafkaPublisher } from "../src/kafka/producer.js";
import { composeUp, kafkaBrokers } from "./health-support.js";
import { startJobLog, type JobLog } from "./job-log.js";
import {
  bootRetryApp,
  deleteRetryRows,
  recordingPublisher,
  rejectingPublisher,
  type RecordingPublisher,
  type RetryApp,
} from "./retry-support.js";

export interface RetrySuite {
  readonly jobs: JobLog;
  readonly live: RetryApp;
  readonly recorded: RecordingPublisher;
  readonly conflicts: RetryApp;
  readonly broken: RetryApp;
  readonly ids: string[];
  stop(): Promise<void>;
}

interface OpenedApps {
  readonly publisher: KafkaPublisher;
  readonly jobs: JobLog;
  readonly live: RetryApp;
  readonly recorded: RecordingPublisher;
  readonly conflicts: RetryApp;
  readonly broken: RetryApp;
}

interface OpeningApps {
  publisher?: KafkaPublisher;
  jobs?: JobLog;
  live?: RetryApp;
  recorded?: RecordingPublisher;
  conflicts?: RetryApp;
  broken?: RetryApp;
}

export async function startRetrySuite(): Promise<RetrySuite> {
  await composeUp();
  const kafka = createKafka(kafkaBrokers);
  const publisher = createKafkaPublisher(kafka);
  const opened: OpeningApps = { publisher };
  try {
    const recorded = recordingPublisher();
    opened.live = await bootRetryApp(publisher);
    opened.jobs = await startJobLog(kafka, `us010-${randomUUID()}`);
    opened.recorded = recorded;
    opened.conflicts = await bootRetryApp(recorded);
    opened.broken = await bootRetryApp(rejectingPublisher());
    return readySuite(requireOpened(opened));
  } catch (error) {
    await closeOpened(opened);
    throw error;
  }
}

function readySuite(opened: OpenedApps): RetrySuite {
  const ids: string[] = [];
  return {
    jobs: opened.jobs,
    live: opened.live,
    recorded: opened.recorded,
    conflicts: opened.conflicts,
    broken: opened.broken,
    ids,
    stop(): Promise<void> {
      return stopSuite(opened, ids);
    },
  };
}

async function stopSuite(opened: OpenedApps, ids: readonly string[]): Promise<void> {
  try {
    await opened.jobs.disconnect();
    await opened.publisher.disconnect();
    await deleteRetryRows(opened.live.pool, ids);
  } finally {
    await opened.broken.close();
    await opened.conflicts.close();
    await opened.live.close();
  }
}

async function closeOpened(opened: OpeningApps): Promise<void> {
  await closeQuietly(opened.jobs?.disconnect());
  await closeQuietly(opened.publisher?.disconnect());
  await closeQuietly(opened.broken?.close());
  await closeQuietly(opened.conflicts?.close());
  await closeQuietly(opened.live?.close());
}

async function closeQuietly(pending: Promise<void> | undefined): Promise<void> {
  if (pending === undefined) {
    return;
  }
  try {
    await pending;
  } catch (error) {
    console.error(error);
  }
}

function requireOpened(opened: OpeningApps): OpenedApps {
  const publisher = opened.publisher;
  const jobs = opened.jobs;
  const live = opened.live;
  const recorded = opened.recorded;
  const conflicts = opened.conflicts;
  const broken = opened.broken;
  if (
    publisher === undefined ||
    jobs === undefined ||
    live === undefined ||
    recorded === undefined ||
    conflicts === undefined ||
    broken === undefined
  ) {
    throw new Error("retry suite did not finish starting");
  }
  return { publisher, jobs, live, recorded, conflicts, broken };
}
