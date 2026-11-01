import type { Pool } from "pg";
import { insertUploadedInvoice, type InvoiceRecord } from "../src/db/invoices.js";
import { saveAcceptedFile } from "../src/services/storage.js";
import { transitionInvoice } from "../src/services/transitions.js";
import { readNumber, readRecord, readString } from "./upload-assertions.js";
import { pdfBytes } from "./upload-bytes.js";

export interface InvoiceDetail {
  readonly chunksCount: number;
  readonly normalizedText: string;
  readonly invoiceNumber: string;
}

export interface ChunkReport {
  readonly count: number;
  readonly dimsOk: number;
  readonly content: string;
}

export interface GoogleWatch {
  calls(): number;
  restore(): void;
}

interface ChunkRow {
  count: unknown;
  dims_ok: unknown;
  content: string | null;
}

export function watchGoogle(): GoogleWatch {
  const original = globalThis.fetch;
  let calls = 0;
  const wrapped: typeof fetch = (input, init) => {
    if (isGoogleHost(input)) {
      calls += 1;
    }
    return original(input, init);
  };
  globalThis.fetch = wrapped;
  return {
    calls(): number {
      return calls;
    },
    restore(): void {
      globalThis.fetch = original;
    },
  };
}

export async function readDetail(baseUrl: string, id: string): Promise<InvoiceDetail> {
  const response = await fetch(`${baseUrl}/api/invoices/${id}`);
  if (response.status !== 200) {
    throw new Error(`invoice detail returned ${String(response.status)}`);
  }
  const body = await readRecord(response);
  const invoice = Reflect.get(body, "invoice");
  if (typeof invoice !== "object" || invoice === null) {
    throw new Error("invoice was missing");
  }
  const extracted = Reflect.get(invoice, "extracted_data");
  if (typeof extracted !== "object" || extracted === null) {
    throw new Error("extracted_data was missing");
  }
  return {
    chunksCount: readNumber(body, "chunksCount"),
    normalizedText: readString(invoice, "normalized_text"),
    invoiceNumber: readString(extracted, "invoiceNumber"),
  };
}

export async function chunkReport(pool: Pool, invoiceId: string): Promise<ChunkReport> {
  const result = await pool.query<ChunkRow>(
    `SELECT COUNT(*)::int AS count,
            COUNT(*) FILTER (WHERE vector_dims(embedding) = 768)::int AS dims_ok,
            COALESCE(string_agg(chunk_content, '' ORDER BY chunk_index), '') AS content
     FROM invoice_chunks
     WHERE invoice_id = $1`,
    [invoiceId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("chunk report was missing");
  }
  return {
    count: integerField(row.count),
    dimsOk: integerField(row.dims_ok),
    content: row.content ?? "",
  };
}

export async function processingInvoice(
  pool: Pool,
  uploadsRoot: string,
  track: (id: string) => void,
): Promise<InvoiceRecord> {
  const bytes = pdfBytes();
  const saved = await saveAcceptedFile(uploadsRoot, bytes, ".pdf");
  const inserted = await insertUploadedInvoice(pool, {
    filename: saved.storedName,
    originalName: "short-vector.pdf",
    mimeType: "application/pdf",
    fileSize: bytes.length,
    filePath: saved.absolutePath,
  });
  track(inserted.id);
  const processing = await transitionInvoice(pool, inserted.id, "uploaded", "processing", {});
  if (processing === undefined) {
    throw new Error("invoice did not enter processing");
  }
  return processing;
}

function isGoogleHost(input: Parameters<typeof fetch>[0]): boolean {
  return requestUrl(input).includes("googleapis.com");
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function integerField(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  throw new Error("expected an integer");
}
