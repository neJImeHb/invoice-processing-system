import type { Pool, QueryResultRow } from "pg";
import type { InvoiceStatus } from "./invoices.js";
import { statisticsFrom } from "./statistics-parse.js";

export interface StatisticsInput {
  readonly status?: InvoiceStatus | "all";
  readonly vendor?: string;
}

export interface RecentInvoice {
  readonly id: string;
  readonly original_name: string;
  readonly status: InvoiceStatus;
  readonly vendor: string | null;
  readonly currency: string | null;
  readonly totalAmount: unknown;
  readonly error_message: string | null;
}

export interface InvoiceStatistics {
  readonly total_count: number;
  readonly uploaded_count: number;
  readonly processing_count: number;
  readonly completed_count: number;
  readonly failed_count: number;
  readonly total_sum: string;
  readonly recent: readonly RecentInvoice[];
}

const STATISTICS_STATUSES = ["uploaded", "processing", "completed", "failed", "all"] as const;

const STATISTICS_SQL = `
WITH filtered AS (
  SELECT id, original_name, status, error_message, extracted_data, created_at,
    CASE
      WHEN jsonb_typeof(extracted_data #> '{financials,totalAmount}') = 'number'
        THEN (extracted_data #>> '{financials,totalAmount}')::numeric
      WHEN jsonb_typeof(extracted_data #> '{financials,totalAmount}') = 'string'
        AND (extracted_data #>> '{financials,totalAmount}') ~ '^-?[0-9]+([.][0-9]+)?$'
        THEN (extracted_data #>> '{financials,totalAmount}')::numeric
      ELSE NULL
    END AS amount
  FROM invoices
  WHERE ($1::text IS NULL OR $1 = 'all' OR status::text = $1)
    AND ($2::text IS NULL OR extracted_data #>> '{vendor,name}' ILIKE $2 ESCAPE '\\')
)
SELECT
  (SELECT COUNT(*)::int FROM invoices) AS total_count,
  (SELECT COUNT(*)::int FROM invoices WHERE status = 'uploaded') AS uploaded_count,
  (SELECT COUNT(*)::int FROM invoices WHERE status = 'processing') AS processing_count,
  (SELECT COUNT(*)::int FROM invoices WHERE status = 'completed') AS completed_count,
  (SELECT COUNT(*)::int FROM invoices WHERE status = 'failed') AS failed_count,
  (SELECT COALESCE(SUM(amount), 0)::text FROM filtered) AS total_sum,
  (
    SELECT COALESCE(
      json_agg(recent_rows.item ORDER BY recent_rows.created_at DESC, recent_rows.id DESC),
      '[]'::json
    )
    FROM (
      SELECT
        json_build_object(
          'id', id,
          'original_name', original_name,
          'status', status::text,
          'vendor', extracted_data #>> '{vendor,name}',
          'currency', extracted_data #>> '{financials,currency}',
          'totalAmount', extracted_data #> '{financials,totalAmount}',
          'error_message', error_message
        ) AS item,
        created_at,
        id
      FROM filtered
      ORDER BY created_at DESC, id DESC
      LIMIT 20
    ) AS recent_rows
  ) AS recent
`;

interface StatisticsRow extends QueryResultRow {
  total_count: unknown;
  uploaded_count: unknown;
  processing_count: unknown;
  completed_count: unknown;
  failed_count: unknown;
  total_sum: unknown;
  recent: unknown;
}

export async function getInvoiceStatisticsAndList(
  pool: Pool,
  input: StatisticsInput,
): Promise<InvoiceStatistics> {
  const result = await pool.query<StatisticsRow>(STATISTICS_SQL, [
    statusParameter(input.status),
    vendorParameter(input.vendor),
  ]);
  return statisticsFrom(result.rows[0]);
}

function statusParameter(status: StatisticsInput["status"]): string | null {
  if (status === undefined) {
    return null;
  }
  if (STATISTICS_STATUSES.some((allowed) => allowed === status)) {
    return status;
  }
  throw new Error("Invoice statistics status is not supported");
}

function vendorParameter(vendor: string | undefined): string | null {
  if (vendor === undefined) {
    return null;
  }
  return vendorLikePattern(vendor);
}

function vendorLikePattern(vendor: string): string {
  const escaped = vendor.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

