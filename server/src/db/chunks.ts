import type { PoolClient } from "pg";
import { EMBEDDING_DIMENSIONS } from "../services/embedder.js";

export interface ChunkMetadata {
  readonly vendor: string;
  readonly invoiceNumber: string | null;
  readonly totalAmount: number;
  readonly date: string | null;
}

export interface NewInvoiceChunk {
  readonly invoiceId: string;
  readonly chunkIndex: number;
  readonly chunkContent: string;
  readonly metadata: ChunkMetadata;
  readonly embedding: readonly number[];
}

export async function deleteInvoiceChunks(client: PoolClient, invoiceId: string): Promise<void> {
  await client.query("DELETE FROM invoice_chunks WHERE invoice_id = $1", [invoiceId]);
}

export async function insertInvoiceChunk(client: PoolClient, chunk: NewInvoiceChunk): Promise<void> {
  await client.query(
    `INSERT INTO invoice_chunks (invoice_id, chunk_index, chunk_content, metadata, embedding)
     VALUES ($1, $2, $3, $4::jsonb, $5::vector)`,
    [
      chunk.invoiceId,
      chunk.chunkIndex,
      chunk.chunkContent,
      JSON.stringify(chunk.metadata),
      vectorLiteral(chunk.embedding),
    ],
  );
}

export function vectorLiteral(embedding: readonly number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding length must be ${String(EMBEDDING_DIMENSIONS)}, received ${String(embedding.length)}`,
    );
  }
  return `[${embedding.join(",")}]`;
}
