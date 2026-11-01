import type { Kafka } from "kafkajs";
import type { Pool } from "pg";
import { expect } from "vitest";
import { deleteInvoiceById, findInvoiceById } from "../src/db/invoices.js";
import { InvoiceExtractionSchema, type InvoiceExtraction } from "../src/domain/extraction.js";
import type { ProcessInvoiceEvent } from "../src/domain/invoice-event.js";
import type { KafkaPublisher } from "../src/kafka/producer.js";
import { INVOICE_JOBS_TOPIC } from "../src/kafka/topic.js";
import type { InvoiceExtractor } from "../src/services/extractor.js";
import { createFakeExtractor, type FakeExtractor } from "../src/services/fakes.js";
import type { BootedTestApp } from "../src/test-server.js";
import { openEventStream, type EventStream } from "./event-stream.js";
import { chunkReport } from "./pipeline-support.js";
import { readRecord, readString } from "./upload-assertions.js";
import { pdfBytes } from "./upload-bytes.js";
import { uploadPdf } from "./upload-event-support.js";
import { postFile } from "./upload-harness.js";

const SLOW_MS = 2_000;

const MISMATCH = {
  invoiceNumber: "INV-200",
  vendor: { name: "Contoso", taxId: null, address: null },
  customer: { name: null, taxId: null },
  dates: { issueDate: null, dueDate: null },
  financials: { currency: "USD", subtotal: null, taxAmount: null, totalAmount: 50 },
  lineItems: [{ description: "consulting", quantity: 1, unitPrice: null, totalPrice: 10 }],
  normalizedText: "Invoice INV-200 from Contoso for consulting. The line total does not equal the grand total.",
};

export type ExtractMode = "fixed" | "throw" | "slow" | "mismatch";

export interface ScriptedExtractor extends FakeExtractor {
  mode: ExtractMode;
  whenSlow(listener: () => void): void;
}

export interface RunningFailureApp {
  readonly pool: Pool;
  readonly kafka: Kafka;
  readonly publisher: KafkaPublisher;
  readonly extractor: ScriptedExtractor;
  readonly booted: BootedTestApp;
}

interface ScriptState {
  calls: number;
  mode: ExtractMode;
  onSlow: (() => void) | undefined;
}

export function createScriptedExtractor(): ScriptedExtractor {
  const inner = createFakeExtractor();
  const state: ScriptState = { calls: 0, mode: "fixed", onSlow: undefined };
  return {
    get calls(): number {
      return state.calls;
    },
    get mode(): ExtractMode {
      return state.mode;
    },
    set mode(value: ExtractMode) {
      state.mode = value;
    },
    whenSlow(listener: () => void): void {
      state.onSlow = listener;
    },
    extract(input: { bytes: Uint8Array; mimeType: string }): Promise<InvoiceExtraction> {
      return runScript(state, inner, input);
    },
  };
}

export function encryptedPdf(): Buffer {
  return Buffer.concat([pdfBytes(), Buffer.from("\n/Encrypt")]);
}

export function truncatedPdf(): Buffer {
  return Buffer.from("%PDF-1.4\n");
}

export async function uploadPdfBytes(baseUrl: string, filename: string, bytes: Buffer): Promise<string> {
  const response = await postFile(baseUrl, { bytes, mime: "application/pdf", filename });
  expect(response.status).toBe(202);
  return readString(await readRecord(response), "id");
}

export function recordingPublisher(inner: KafkaPublisher, sent: ProcessInvoiceEvent[]): KafkaPublisher {
  return {
    publish(invoiceId: string, event: ProcessInvoiceEvent): Promise<void> {
      sent.push(event);
      return inner.publish(invoiceId, event);
    },
    disconnect(): Promise<void> {
      return inner.disconnect();
    },
  };
}

export function sentEvent(sent: readonly ProcessInvoiceEvent[], invoiceId: string): ProcessInvoiceEvent {
  const event = sent.find((item) => item.invoiceId === invoiceId);
  if (event === undefined) {
    throw new Error("published invoice event was missing");
  }
  return event;
}

export async function publishPoison(kafka: Kafka): Promise<{ partition: number; offset: string }> {
  const producer = kafka.producer();
  await producer.connect();
  try {
    const stored = await producer.send({
      topic: INVOICE_JOBS_TOPIC,
      messages: [{ value: JSON.stringify({ type: "POISON" }) }],
    });
    return requiredOffset(stored[0]);
  } finally {
    await producer.disconnect();
  }
}

export function statusNeedle(invoiceId: string, status: string): string {
  return `"invoiceId":"${invoiceId}","status":"${status}"`;
}

export async function withInvoiceStream(baseUrl: string, run: (stream: EventStream) => Promise<void>): Promise<void> {
  const stream = await openEventStream(`${baseUrl}/api/events/invoices`);
  try {
    await run(stream);
  } finally {
    await stream.stop();
  }
}

async function runScript(
  state: ScriptState,
  inner: InvoiceExtractor,
  input: { bytes: Uint8Array; mimeType: string },
): Promise<InvoiceExtraction> {
  state.calls += 1;
  if (state.mode === "throw") {
    throw new Error("model refused");
  }
  if (state.mode === "slow") {
    noteSlow(state);
    await delay(SLOW_MS);
  }
  if (state.mode === "mismatch") {
    return InvoiceExtractionSchema.parse(MISMATCH);
  }
  return inner.extract(input);
}

function noteSlow(state: ScriptState): void {
  const notify = state.onSlow;
  state.onSlow = undefined;
  notify?.();
}

function requiredOffset(record: { partition: number; offset?: string; baseOffset?: string } | undefined): {
  partition: number;
  offset: string;
} {
  const offset = record?.offset ?? record?.baseOffset;
  if (record === undefined || offset === undefined) {
    throw new Error("poison payload was not stored");
  }
  return { partition: record.partition, offset };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function assertDeletedDuringExtract(
  active: RunningFailureApp,
  baseUrl: string,
  beats: number,
  started: Promise<void>,
  track: (id: string) => string,
): Promise<void> {
  await withInvoiceStream(baseUrl, async (stream) => {
    const id = track(await uploadPdf(baseUrl, "slow.pdf"));
    await stream.waitForText(statusNeedle(id, "processing"), 30_000);
    await started;
    const mark = stream.text().length;
    expect(await deleteInvoiceById(active.pool, id)).toBe(true);
    active.extractor.mode = "fixed";
    const next = track(await uploadPdf(baseUrl, "after-delete.pdf"));
    await stream.waitForText(statusNeedle(next, "completed"), 30_000);
    expect(active.booted.heartbeatCount()).toBeGreaterThanOrEqual(beats + 1);
    expect(await findInvoiceById(active.pool, id)).toBeUndefined();
    expect((await chunkReport(active.pool, id)).count).toBe(0);
    const extra = stream.text().slice(mark);
    expect(extra.includes(statusNeedle(id, "failed"))).toBe(false);
    expect(extra.includes(statusNeedle(id, "completed"))).toBe(false);
  });
}
