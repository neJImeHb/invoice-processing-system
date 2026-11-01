import type { Pool } from "pg";
import { insertInvoiceChunk } from "../src/db/chunks.js";
import { EMBEDDING_DIMENSIONS, type InvoiceEmbedder } from "../src/services/embedder.js";

export async function insertChunks(
  pool: Pool,
  invoiceId: string,
  rows: readonly { readonly content: string; readonly embedding: readonly number[] }[],
): Promise<void> {
  const client = await pool.connect();
  try {
    for (const [index, row] of rows.entries()) {
      await insertInvoiceChunk(client, {
        invoiceId,
        chunkIndex: index,
        chunkContent: row.content,
        metadata: { vendor: "chunk", invoiceNumber: null, totalAmount: 0, date: null },
        embedding: row.embedding,
      });
    }
  } finally {
    client.release();
  }
}

export async function chunkCount(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: unknown }>("SELECT COUNT(*)::int AS count FROM invoice_chunks");
  const count = result.rows[0]?.count;
  if (typeof count !== "number" || !Number.isInteger(count)) {
    throw new Error("chunk count was not an integer");
  }
  return count;
}

export function unitVector(seed: string): number[] {
  const values = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  for (let index = 0; index < seed.length; index += 1) {
    const slot = index % EMBEDDING_DIMENSIONS;
    const current = values[slot] ?? 0;
    values[slot] = current + seed.charCodeAt(index) + 1;
  }
  return normalized(values);
}

export function vectorEmbedder(vector: readonly number[]): InvoiceEmbedder & { texts(): readonly string[] } {
  const seen: string[] = [];
  return {
    texts(): readonly string[] {
      return [...seen];
    },
    embed(text: string): Promise<readonly number[]> {
      seen.push(text);
      return Promise.resolve([...vector]);
    },
  };
}

function normalized(values: readonly number[]): number[] {
  const squares = values.reduce((sum, value) => sum + value * value, 0);
  const magnitude = Math.sqrt(squares);
  if (magnitude === 0) {
    throw new Error("vector norm was zero");
  }
  return values.map((value) => value / magnitude);
}
