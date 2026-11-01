import type { Pool } from "pg";
import type { AppDependencies, InvoicePublisher } from "../src/app.js";
import type { InvoiceStatus } from "../src/db/invoices.js";
import type { SseHub } from "../src/services/sse.js";
import { probe } from "./health-support.js";
import { createdAt, type ToolFixture } from "./tools-db.js";

export interface InvoiceSnapshot {
  readonly status: string;
  readonly errorMessage: string | null;
  readonly retryCount: number;
}

export async function readInvoiceSnapshot(pool: Pool, id: string): Promise<InvoiceSnapshot> {
  const result = await pool.query<{ status: string; error_message: string | null; retry_count: unknown }>(
    "SELECT status::text AS status, error_message, retry_count FROM invoices WHERE id = $1",
    [id],
  );
  return snapshot(result.rows[0]);
}

export function namedFixture(status: InvoiceStatus, originalName: string, runId: string, second: number): ToolFixture {
  return {
    status,
    originalName,
    vendor: `retry${runId}`,
    totalAmount: null,
    currency: "USD",
    invoiceNumber: null,
    errorMessage: status === "failed" ? "extraction failed" : null,
    createdAt: createdAt(2020, second),
  };
}

export function vectorInvoiceFixture(runId: string): ToolFixture {
  return {
    status: "completed",
    originalName: `vector-${runId}.pdf`,
    vendor: `Vector ${runId}`,
    totalAmount: 64,
    currency: "EUR",
    invoiceNumber: "INV-US014",
    errorMessage: null,
    createdAt: createdAt(9997, 1),
  };
}

export function toolDependencies(pool: Pool, publisher: InvoicePublisher, sse: SseHub): AppDependencies {
  return {
    pool,
    publisher,
    sse,
    uploadsRoot: ".",
    postgres: probe(true),
    kafka: probe(true),
  };
}

function snapshot(
  row: { status: string; error_message: string | null; retry_count: unknown } | undefined,
): InvoiceSnapshot {
  if (row === undefined) {
    throw new Error("invoice snapshot was missing");
  }
  return {
    status: row.status,
    errorMessage: row.error_message,
    retryCount: wholeCount(row.retry_count),
  };
}

function wholeCount(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  throw new Error("invoice snapshot was missing");
}
