import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { Pool } from "pg";
import type { InvoicePublisher } from "../src/app.js";
import type { InvoiceStatus } from "../src/db/invoices.js";
import { bootTestApp, type BootedTestApp } from "../src/test-server.js";
import { closeServer, databaseUrl, kafkaBrokers, listen } from "./health-support.js";

export interface SeededInvoice {
  readonly id: string;
  readonly filePath: string;
  readonly mimeType: string;
  readonly errorMessage: string | null;
  readonly retryCount: number;
}

export interface RetrySnapshot {
  readonly status: string;
  readonly errorMessage: string | null;
  readonly retryCount: number;
  readonly updatedAt: string;
}

export interface RecordingPublisher extends InvoicePublisher {
  calls(): readonly string[];
}

export interface RetryApp {
  readonly baseUrl: string;
  readonly pool: Pool;
  close(): Promise<void>;
}

interface InsertedId {
  id: string;
}

interface SnapshotRow {
  status: string;
  error_message: string | null;
  retry_count: unknown;
  updated_at: Date | string;
}

export function recordingPublisher(): RecordingPublisher {
  const seen: string[] = [];
  return {
    calls(): readonly string[] {
      return [...seen];
    },
    publish(invoiceId: string): Promise<void> {
      seen.push(invoiceId);
      return Promise.resolve();
    },
  };
}

export function rejectingPublisher(): InvoicePublisher {
  return {
    publish(): Promise<void> {
      return Promise.reject(new Error("broker down"));
    },
  };
}

export async function bootRetryApp(publisher: InvoicePublisher): Promise<RetryApp> {
  const booted = await bootTestApp({ databaseUrl, kafkaBrokers, publisher });
  try {
    const started = await listen(booted.app);
    return {
      baseUrl: started.url,
      pool: booted.pool,
      close(): Promise<void> {
        return closeRetryApp(started.server, booted);
      },
    };
  } catch (error) {
    await booted.shutdown();
    throw error;
  }
}

export async function insertRetryRow(
  pool: Pool,
  status: InvoiceStatus,
  errorMessage: string | null,
): Promise<SeededInvoice> {
  const filePath = `uploads/retry-${randomUUID()}.pdf`;
  const mimeType = "application/pdf";
  const result = await pool.query<InsertedId>(
    `INSERT INTO invoices (
       filename, original_name, mime_type, file_size, file_path, status, error_message, retry_count
     )
     VALUES ($1, $2, $3, $4, $5, $6::invoice_status, $7, 0)
     RETURNING id`,
    [`${randomUUID()}.pdf`, "retry.pdf", mimeType, 32, filePath, status, errorMessage],
  );
  return { id: insertedId(result.rows[0]), filePath, mimeType, errorMessage, retryCount: 0 };
}

export async function readRetryRow(pool: Pool, id: string): Promise<RetrySnapshot> {
  const result = await pool.query<SnapshotRow>(
    "SELECT status, error_message, retry_count, updated_at FROM invoices WHERE id = $1",
    [id],
  );
  return snapshot(result.rows[0]);
}

export async function deleteRetryRows(pool: Pool, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await pool.query("DELETE FROM invoices WHERE id = ANY($1::uuid[])", [ids]);
}

export function postRetry(baseUrl: string, id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/invoices/${encodeURIComponent(id)}/retry`, { method: "POST" });
}

async function closeRetryApp(server: Server, booted: BootedTestApp): Promise<void> {
  try {
    server.closeAllConnections();
    await closeServer(server);
  } finally {
    await booted.shutdown();
  }
}

function insertedId(row: InsertedId | undefined): string {
  if (row === undefined || row.id.length === 0) {
    throw new Error("retry invoice was not inserted");
  }
  return row.id;
}

function snapshot(row: SnapshotRow | undefined): RetrySnapshot {
  if (row === undefined) {
    throw new Error("retry invoice was missing");
  }
  return {
    status: row.status,
    errorMessage: row.error_message,
    retryCount: wholeCount(row.retry_count),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function wholeCount(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  throw new Error("retry_count was not a count");
}

function isoTimestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("updated_at was not a timestamp");
  }
  return parsed.toISOString();
}
