import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import { deleteInvoiceChunks, insertInvoiceChunk, type ChunkMetadata } from "../db/chunks.js";
import type { InvoiceRecord } from "../db/invoices.js";
import { InvoiceExtractionSchema, type InvoiceExtraction } from "../domain/extraction.js";
import type { InvoiceEmbedder } from "./embedder.js";
import type { InvoiceExtractor } from "./extractor.js";
import { chunkText } from "./chunker.js";
import { guardInvoiceBytes, UNREADABLE_FILE_MESSAGE } from "./pdf-guard.js";
import { documentTitle, prefixDocument } from "./prefixes.js";
import type { SseHub } from "./sse.js";
import { openInsideUploads, PathEscapeError, StoredFileNotFoundError } from "./storage.js";
import { transitionInvoice } from "./transitions.js";

export interface PipelineDeps {
  readonly pool: Pool;
  readonly sse: SseHub;
  readonly extractor: InvoiceExtractor;
  readonly embedder: InvoiceEmbedder;
  readonly uploadsRoot: string;
}

interface EmbeddedChunk {
  readonly content: string;
  readonly embedding: readonly number[];
}

export async function completeInvoice(
  deps: PipelineDeps,
  invoice: InvoiceRecord,
): Promise<InvoiceRecord | undefined> {
  const bytes = await readInvoiceBytes(deps.uploadsRoot, invoice.file_path);
  assertAccepted(bytes, invoice.mime_type);
  const extraction = await extractDocument(deps.extractor, bytes, invoice.mime_type);
  const chunks = chunkText(extraction.normalizedText);
  if (chunks.length === 0) {
    throw new Error("Invoice normalized text produced no chunks");
  }
  const embedded = await embedChunks(deps.embedder, extraction, invoice.original_name, chunks);
  return commitCompleted(deps, invoice.id, extraction, embedded);
}

async function readInvoiceBytes(uploadsRoot: string, filePath: string): Promise<Uint8Array> {
  try {
    const absolutePath = await openInsideUploads(uploadsRoot, filePath);
    return await readFile(absolutePath);
  } catch (error) {
    if (error instanceof StoredFileNotFoundError || error instanceof PathEscapeError) {
      throw new Error(UNREADABLE_FILE_MESSAGE, { cause: error });
    }
    throw error;
  }
}

function assertAccepted(bytes: Uint8Array, mimeType: string): void {
  const verdict = guardInvoiceBytes(bytes, mimeType);
  if (!verdict.ok) {
    throw new Error(verdict.errorMessage);
  }
}

async function extractDocument(
  extractor: InvoiceExtractor,
  bytes: Uint8Array,
  mimeType: string,
): Promise<InvoiceExtraction> {
  return InvoiceExtractionSchema.parse(await extractor.extract({ bytes, mimeType }));
}

async function embedChunks(
  embedder: InvoiceEmbedder,
  extraction: InvoiceExtraction,
  originalName: string,
  chunks: readonly string[],
): Promise<EmbeddedChunk[]> {
  const title = documentTitle(extraction.vendor.name, originalName);
  const embedded: EmbeddedChunk[] = [];
  for (const content of chunks) {
    embedded.push({
      content,
      embedding: await embedder.embed(prefixDocument(title, content)),
    });
  }
  return embedded;
}

async function commitCompleted(
  deps: PipelineDeps,
  invoiceId: string,
  extraction: InvoiceExtraction,
  chunks: readonly EmbeddedChunk[],
): Promise<InvoiceRecord | undefined> {
  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const row = await writeCompleted(client, invoiceId, extraction, chunks);
      if (row === undefined) {
        await client.query("ROLLBACK");
        return undefined;
      }
      await client.query("COMMIT");
      return row;
    } catch (error) {
      await rollback(client);
      throw error;
    }
  } finally {
    client.release();
  }
}

async function writeCompleted(
  client: PoolClient,
  invoiceId: string,
  extraction: InvoiceExtraction,
  chunks: readonly EmbeddedChunk[],
): Promise<InvoiceRecord | undefined> {
  await deleteInvoiceChunks(client, invoiceId);
  const row = await transitionInvoice(client, invoiceId, "processing", "completed", {
    extractedData: extraction,
    normalizedText: extraction.normalizedText,
    completedAt: new Date(),
    errorMessage: null,
  });
  if (row === undefined) {
    return undefined;
  }
  await insertCompletedChunks(client, invoiceId, extraction, chunks);
  return row;
}

async function insertCompletedChunks(
  client: PoolClient,
  invoiceId: string,
  extraction: InvoiceExtraction,
  chunks: readonly EmbeddedChunk[],
): Promise<void> {
  const metadata = chunkMetadata(extraction);
  for (const [index, chunk] of chunks.entries()) {
    await insertInvoiceChunk(client, {
      invoiceId,
      chunkIndex: index,
      chunkContent: chunk.content,
      metadata,
      embedding: chunk.embedding,
    });
  }
}

function chunkMetadata(extraction: InvoiceExtraction): ChunkMetadata {
  return {
    vendor: extraction.vendor.name,
    invoiceNumber: extraction.invoiceNumber,
    totalAmount: extraction.financials.totalAmount,
    date: extraction.dates.issueDate,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    console.error(rollbackError);
  }
}
