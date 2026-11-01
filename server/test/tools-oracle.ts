import type { Pool } from "pg";

const COUNT_SQL = `
SELECT
  COUNT(*)::int AS total_count,
  COUNT(*) FILTER (WHERE status = 'uploaded')::int AS uploaded_count,
  COUNT(*) FILTER (WHERE status = 'processing')::int AS processing_count,
  COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count,
  COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
FROM invoices
`;

const SUM_SQL = `
SELECT COALESCE(SUM(amount), 0)::text AS total_sum
FROM (
  SELECT
    CASE
      WHEN jsonb_typeof(extracted_data #> '{financials,totalAmount}') = 'number'
        THEN (extracted_data #>> '{financials,totalAmount}')::numeric
      WHEN jsonb_typeof(extracted_data #> '{financials,totalAmount}') = 'string'
        AND (extracted_data #>> '{financials,totalAmount}') ~ '^-?[0-9]+([.][0-9]+)?$'
        THEN (extracted_data #>> '{financials,totalAmount}')::numeric
      ELSE NULL
    END AS amount
  FROM invoices
  WHERE ($1::text IS NULL OR status::text = $1)
    AND ($2::text IS NULL OR extracted_data #>> '{vendor,name}' ILIKE $2 ESCAPE '\\')
) amounts
`;

export interface CountOracle {
  readonly total_count: number;
  readonly uploaded_count: number;
  readonly processing_count: number;
  readonly completed_count: number;
  readonly failed_count: number;
}

export function oracleLikePattern(vendor: string): string {
  const escaped = vendor.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

export async function countInvoices(pool: Pool): Promise<CountOracle> {
  const result = await pool.query<CountOracle>(COUNT_SQL);
  return countRow(result.rows[0]);
}

export async function summedAmounts(
  pool: Pool,
  status: string | null,
  pattern: string | null,
): Promise<string> {
  const result = await pool.query<{ total_sum: unknown }>(SUM_SQL, [status, pattern]);
  const value = result.rows[0]?.total_sum;
  if (typeof value !== "string") {
    throw new Error("sum oracle was not text");
  }
  return value;
}

export async function sameNumeric(pool: Pool, left: string, right: string): Promise<boolean> {
  const result = await pool.query<{ same: boolean }>("SELECT ($1::numeric = $2::numeric) AS same", [left, right]);
  return result.rows[0]?.same === true;
}

function countRow(row: CountOracle | undefined): CountOracle {
  if (row === undefined) {
    throw new Error("count oracle returned no row");
  }
  return {
    total_count: count(row.total_count),
    uploaded_count: count(row.uploaded_count),
    processing_count: count(row.processing_count),
    completed_count: count(row.completed_count),
    failed_count: count(row.failed_count),
  };
}

function count(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  throw new Error("count oracle was not an integer");
}
