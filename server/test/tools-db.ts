import type { Pool } from "pg";
import type { InvoiceStatus } from "../src/db/invoices.js";

const INSERT_INVOICE = `
INSERT INTO invoices (
  filename, original_name, mime_type, file_size, file_path, status,
  error_message, extracted_data, created_at
)
VALUES ($1, $2, 'application/pdf', 32, $3, $4::invoice_status, $5, $6::jsonb, $7::timestamptz)
RETURNING id
`;

export interface ToolFixture {
  readonly status: InvoiceStatus;
  readonly originalName: string;
  readonly vendor: string;
  readonly totalAmount: unknown;
  readonly currency: string;
  readonly invoiceNumber: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
}

export interface StatisticsSeed {
  readonly runId: string;
  readonly ids: Readonly<Record<string, string>>;
  readonly idList: readonly string[];
}

interface SeedSpec {
  readonly key: string;
  readonly status: InvoiceStatus;
  readonly totalAmount: unknown;
  readonly second: number;
  readonly vendor?: string;
  readonly vendorKey?: string;
  readonly currency?: string;
  readonly errorMessage?: string;
}

const FIXTURES: readonly SeedSpec[] = [
  { key: "uploaded", status: "uploaded", vendorKey: "up", totalAmount: 888, second: 1 },
  { key: "processing", status: "processing", vendorKey: "proc", totalAmount: 7, second: 2 },
  { key: "completed", status: "completed", vendorKey: "num", totalAmount: 10, currency: "EUR", second: 3 },
  { key: "text", status: "completed", vendorKey: "text", totalAmount: "15.50", second: 4 },
  { key: "bad", status: "completed", vendorKey: "bad", totalAmount: "not-a-number", second: 5 },
  { key: "object", status: "completed", vendorKey: "obj", totalAmount: { raw: 5 }, second: 6 },
  { key: "failed", status: "failed", vendorKey: "fail", totalAmount: 999, errorMessage: "extraction failed", second: 7 },
  { key: "percent", status: "completed", vendor: "100%", totalAmount: 21, second: 50 },
  { key: "thousand", status: "completed", vendor: "1000", totalAmount: 50, second: 49 },
  { key: "underscore", status: "completed", vendor: "a_b", totalAmount: 3, second: 48 },
  { key: "wild", status: "completed", vendor: "axb", totalAmount: 9, second: 47 },
  { key: "slash", status: "completed", vendor: "a\\b", totalAmount: 4, second: 46 },
  { key: "noslash", status: "completed", vendor: "ab", totalAmount: 8, second: 45 },
];

export async function seedStatistics(pool: Pool, runId: string): Promise<StatisticsSeed> {
  const ids: Record<string, string> = {};
  const idList: string[] = [];
  try {
    await insertFixtures(pool, ids, idList, runId);
    return { runId, ids, idList };
  } catch (error) {
    try {
      await deleteToolInvoices(pool, idList);
    } catch (cleanupError) {
      console.error(cleanupError);
    }
    throw error;
  }
}

export function seededId(seed: StatisticsSeed, key: string): string {
  const id = seed.ids[key];
  if (id === undefined) {
    throw new Error(`fixture ${key} was not inserted`);
  }
  return id;
}

export async function insertToolInvoice(pool: Pool, fixture: ToolFixture): Promise<string> {
  const extracted = {
    invoiceNumber: fixture.invoiceNumber,
    vendor: { name: fixture.vendor },
    financials: { currency: fixture.currency, totalAmount: fixture.totalAmount },
  };
  const result = await pool.query<{ id: unknown }>(INSERT_INVOICE, [
    fixture.originalName,
    fixture.originalName,
    `uploads/${fixture.originalName}`,
    fixture.status,
    fixture.errorMessage,
    JSON.stringify(extracted),
    fixture.createdAt,
  ]);
  return requiredId(result.rows[0]?.id);
}

export async function deleteToolInvoices(pool: Pool, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await pool.query("DELETE FROM invoices WHERE id = ANY($1::uuid[])", [ids]);
}

async function insertFixtures(
  pool: Pool,
  ids: Record<string, string>,
  idList: string[],
  runId: string,
): Promise<void> {
  for (const spec of FIXTURES) {
    const id = await insertToolInvoice(pool, fixtureFromSpec(spec, runId));
    ids[spec.key] = id;
    idList.push(id);
  }
  for (let index = 0; index <= 20; index += 1) {
    const key = `limit-${String(index)}`;
    const id = await insertToolInvoice(pool, limitFixture(runId, index));
    ids[key] = id;
    idList.push(id);
  }
}

function fixtureFromSpec(spec: SeedSpec, runId: string): ToolFixture {
  return {
    status: spec.status,
    originalName: `${spec.key}-${runId}.pdf`,
    vendor: vendorName(spec, runId),
    totalAmount: spec.totalAmount,
    currency: spec.currency ?? "USD",
    invoiceNumber: null,
    errorMessage: spec.errorMessage ?? null,
    createdAt: createdAt(9999, spec.second),
  };
}

function limitFixture(runId: string, index: number): ToolFixture {
  return {
    status: "uploaded",
    originalName: `limit-${String(index)}-${runId}.pdf`,
    vendor: `lim${runId}`,
    totalAmount: index,
    currency: "USD",
    invoiceNumber: null,
    errorMessage: null,
    createdAt: createdAt(9998, index),
  };
}

function vendorName(spec: SeedSpec, runId: string): string {
  if (spec.vendor !== undefined) {
    return spec.vendor;
  }
  if (spec.vendorKey !== undefined) {
    return `${spec.vendorKey}${runId}`;
  }
  throw new Error("fixture vendor was missing");
}

export function createdAt(year: number, second: number): string {
  return `${String(year)}-06-15T00:00:${String(second).padStart(2, "0")}Z`;
}

function requiredId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("fixture invoice was not inserted");
  }
  return value;
}

