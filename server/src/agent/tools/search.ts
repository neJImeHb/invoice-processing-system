import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { vectorLiteral } from "../../db/chunks.js";
import type { InvoiceEmbedder } from "../../services/embedder.js";
import { prefixQuery } from "../../services/prefixes.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

const VECTOR_SEARCH_SQL = `
SELECT
  invoice_chunks.chunk_content,
  invoices.original_name,
  invoices.extracted_data #>> '{vendor,name}' AS vendor,
  invoices.extracted_data ->> 'invoiceNumber' AS invoice_number,
  invoices.extracted_data #>> '{financials,totalAmount}' AS total,
  invoices.extracted_data #>> '{financials,currency}' AS currency,
  1 - (invoice_chunks.embedding <=> $1::vector) AS similarity
FROM invoice_chunks
JOIN invoices ON invoices.id = invoice_chunks.invoice_id
ORDER BY invoice_chunks.embedding <=> $1::vector
LIMIT $2
`;

export interface VectorSearchInput {
  readonly query: string;
  readonly limit?: number;
}

export interface VectorHit {
  readonly chunkText: string;
  readonly fileName: string;
  readonly vendor: string | null;
  readonly invoiceNumber: string | null;
  readonly total: string | null;
  readonly currency: string | null;
  readonly similarity: number;
}

interface VectorRow extends QueryResultRow {
  chunk_content: unknown;
  original_name: unknown;
  vendor: unknown;
  invoice_number: unknown;
  total: unknown;
  currency: unknown;
  similarity: unknown;
}

export async function searchInvoicesVector(
  pool: Pool | PoolClient,
  embedder: InvoiceEmbedder,
  input: VectorSearchInput,
): Promise<readonly VectorHit[]> {
  const embedding = await embedder.embed(prefixQuery(requiredQuery(input.query)));
  const result = await queryRows<VectorRow>(pool, vectorLiteral(embedding), vectorLimit(input.limit));
  return result.rows.map(vectorHit);
}

function requiredQuery(query: string): string {
  if (typeof query !== "string") {
    throw new Error("Vector search query is required");
  }
  return query;
}

function vectorLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Vector search limit must be a positive integer");
  }
  if (limit > MAX_LIMIT) {
    return MAX_LIMIT;
  }
  return limit;
}

function queryRows<T extends QueryResultRow>(
  pool: Pool | PoolClient,
  vector: string,
  limit: number,
): Promise<QueryResult<T>> {
  if ("release" in pool) {
    return pool.query<T>(VECTOR_SEARCH_SQL, [vector, limit]);
  }
  return pool.query<T>(VECTOR_SEARCH_SQL, [vector, limit]);
}

function vectorHit(row: VectorRow): VectorHit {
  return {
    chunkText: textValue(row.chunk_content, "chunk text"),
    fileName: textValue(row.original_name, "file name"),
    vendor: optionalText(row.vendor, "vendor"),
    invoiceNumber: optionalText(row.invoice_number, "invoice number"),
    total: optionalText(row.total, "total"),
    currency: optionalText(row.currency, "currency"),
    similarity: similarityValue(row.similarity),
  };
}

function similarityValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?[0-9]+(\.[0-9]+)?$/.test(value)) {
    return Number(value);
  }
  throw new Error("Vector similarity was not a number");
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} was not text`);
  }
  return value;
}

function optionalText(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  return textValue(value, label);
}
