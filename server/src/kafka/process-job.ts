import type { Consumer, EachMessagePayload, Kafka } from "kafkajs";
import type { Pool } from "pg";
import { findInvoiceById, type InvoiceRecord, type InvoiceStatus } from "../db/invoices.js";
import { ProcessInvoiceEventSchema } from "../domain/extraction.js";
import type { ProcessInvoiceEvent } from "../domain/invoice-event.js";
import type { InvoiceEmbedder } from "../services/embedder.js";
import type { InvoiceExtractor } from "../services/extractor.js";
import { publishInvoiceStatus } from "../services/invoice-status.js";
import { failInvoice } from "../services/fail-invoice.js";
import { completeInvoice, type PipelineDeps } from "../services/pipeline.js";
import type { SseHub } from "../services/sse.js";
import { transitionInvoice } from "../services/transitions.js";

export interface InvoiceConsumerDeps {
  readonly kafka: Kafka;
  readonly pool: Pool;
  readonly sse: SseHub;
  readonly extractor: InvoiceExtractor;
  readonly embedder: InvoiceEmbedder;
  readonly uploadsRoot: string;
}

export async function handleInvoiceMessage(
  deps: InvoiceConsumerDeps,
  consumer: Consumer,
  payload: EachMessagePayload,
): Promise<void> {
  const event = readEvent(payload.message.value);
  if (event === undefined) {
    await commitOffset(consumer, payload);
    return;
  }
  const invoice = await findInvoiceById(deps.pool, event.invoiceId);
  if (invoice === undefined || isFinished(invoice.status)) {
    await commitOffset(consumer, payload);
    return;
  }
  if (invoice.status === "processing") {
    await resumeProcessing(deps, consumer, payload, invoice);
    return;
  }
  if (invoice.status === "uploaded") {
    await beginProcessing(deps, consumer, payload, invoice.id);
    return;
  }
  await commitOffset(consumer, payload);
}

async function resumeProcessing(
  deps: InvoiceConsumerDeps,
  consumer: Consumer,
  payload: EachMessagePayload,
  invoice: InvoiceRecord,
): Promise<void> {
  if (invoice.extracted_data !== null) {
    await commitOffset(consumer, payload);
    return;
  }
  await finishInvoice(deps, consumer, payload, invoice);
}

async function beginProcessing(
  deps: InvoiceConsumerDeps,
  consumer: Consumer,
  payload: EachMessagePayload,
  invoiceId: string,
): Promise<void> {
  const processing = await transitionInvoice(deps.pool, invoiceId, "uploaded", "processing", {});
  if (processing === undefined) {
    await commitOffset(consumer, payload);
    return;
  }
  publishInvoiceStatus(deps.sse, processing);
  await finishInvoice(deps, consumer, payload, processing);
}

async function finishInvoice(
  deps: InvoiceConsumerDeps,
  consumer: Consumer,
  payload: EachMessagePayload,
  invoice: InvoiceRecord,
): Promise<void> {
  try {
    await finishCompleted(deps, consumer, payload, invoice);
  } catch (error) {
    await finishFailed(deps, consumer, payload, invoice.id, error);
  }
}

async function finishCompleted(
  deps: InvoiceConsumerDeps,
  consumer: Consumer,
  payload: EachMessagePayload,
  invoice: InvoiceRecord,
): Promise<void> {
  const completed = await completeInvoice(pipelineDeps(deps), invoice);
  await commitOffset(consumer, payload);
  if (completed !== undefined) {
    publishInvoiceStatus(deps.sse, completed);
  }
}

async function finishFailed(
  deps: InvoiceConsumerDeps,
  consumer: Consumer,
  payload: EachMessagePayload,
  invoiceId: string,
  error: unknown,
): Promise<void> {
  const failed = await failInvoice(deps.pool, invoiceId, failureText(error));
  await commitOffset(consumer, payload);
  if (failed !== undefined) {
    publishInvoiceStatus(deps.sse, failed);
  }
}

function failureText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Invoice processing failed";
}

function pipelineDeps(deps: InvoiceConsumerDeps): PipelineDeps {
  return {
    pool: deps.pool,
    sse: deps.sse,
    extractor: deps.extractor,
    embedder: deps.embedder,
    uploadsRoot: deps.uploadsRoot,
  };
}

function isFinished(status: InvoiceStatus): boolean {
  return status === "completed" || status === "failed";
}

async function commitOffset(consumer: Consumer, payload: EachMessagePayload): Promise<void> {
  await consumer.commitOffsets([
    {
      topic: payload.topic,
      partition: payload.partition,
      offset: String(Number(payload.message.offset) + 1),
    },
  ]);
}

function readEvent(value: Buffer | null): ProcessInvoiceEvent | undefined {
  if (value === null) {
    console.error("Invoice job payload was empty");
    return undefined;
  }
  const parsed = parsePayload(value);
  if (parsed === undefined) {
    return undefined;
  }
  const result = ProcessInvoiceEventSchema.safeParse(parsed);
  if (!result.success) {
    console.error(result.error);
    return undefined;
  }
  return result.data;
}

function parsePayload(value: Buffer): unknown {
  try {
    return JSON.parse(value.toString("utf8")) as unknown;
  } catch (error) {
    console.error(error);
    return undefined;
  }
}
