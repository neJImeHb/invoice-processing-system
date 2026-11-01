import type { Pool } from "pg";
import {
  getInvoiceStatisticsAndList,
  type InvoiceStatistics,
  type RecentInvoice,
} from "../src/agent/tools/statistics.js";
import { seededId, type StatisticsSeed } from "./tools-db.js";
import { countInvoices, oracleLikePattern, sameNumeric, summedAmounts } from "./tools-oracle.js";

export async function expectWholeTableCounts(pool: Pool, seed: StatisticsSeed, runId: string): Promise<void> {
  const filtered = await getInvoiceStatisticsAndList(pool, { status: "completed", vendor: "100%" });
  await expectWholeCounts(pool, filtered);
  const open = await getInvoiceStatisticsAndList(pool, {});
  await expectWholeCounts(pool, open);
  expectStatus(open, seed, "uploaded");
  expectStatus(open, seed, "processing");
  expectStatus(open, seed, "completed");
  if (recentRow(open, seed, "completed").currency !== "EUR") {
    throw new Error("completed currency was not returned");
  }
  const failed = recentRow(open, seed, "failed");
  if (
    failed.original_name !== `failed-${runId}.pdf` ||
    failed.vendor !== `fail${runId}` ||
    failed.currency !== "USD" ||
    failed.totalAmount !== 999 ||
    failed.error_message !== "extraction failed"
  ) {
    throw new Error("failed invoice fields were not returned");
  }
  await expectSum(pool, open.total_sum, null, null);
  const all = await getInvoiceStatisticsAndList(pool, { status: "all" });
  await expectSum(pool, all.total_sum, null, null);
}

export async function expectCompletedSum(pool: Pool, seed: StatisticsSeed, runId: string): Promise<void> {
  const completed = await getInvoiceStatisticsAndList(pool, { status: "completed" });
  await expectSum(pool, completed.total_sum, "completed", null);
  const recentIds = completed.recent.map((row) => row.id);
  if (!recentIds.includes(seededId(seed, "completed"))) {
    throw new Error("completed sum omitted a completed invoice");
  }
  if (recentIds.includes(seededId(seed, "failed")) || recentIds.includes(seededId(seed, "uploaded"))) {
    throw new Error("completed sum included a non-completed invoice");
  }
  const bad = await getInvoiceStatisticsAndList(pool, { vendor: `bad${runId}` });
  if (recentRow(bad, seed, "bad").totalAmount !== "not-a-number") {
    throw new Error("non-numeric total was not returned");
  }
  await expectSame(pool, bad.total_sum, "0");
  const text = await getInvoiceStatisticsAndList(pool, { vendor: `text${runId}` });
  if (recentRow(text, seed, "text").totalAmount !== "15.50") {
    throw new Error("numeric text total was not returned");
  }
  await expectSame(pool, text.total_sum, "15.50");
  const objectRow = await getInvoiceStatisticsAndList(pool, { vendor: `obj${runId}` });
  if (JSON.stringify(recentRow(objectRow, seed, "object").totalAmount) !== JSON.stringify({ raw: 5 })) {
    throw new Error("object total changed the sum");
  }
  await expectSame(pool, objectRow.total_sum, "0");
  const failedOnly = await getInvoiceStatisticsAndList(pool, { status: "completed", vendor: `fail${runId}` });
  if (failedOnly.recent.length !== 0) {
    throw new Error("completed filter included a failed invoice");
  }
  await expectSame(pool, failedOnly.total_sum, "0");
  const uploadedOnly = await getInvoiceStatisticsAndList(pool, { status: "completed", vendor: `up${runId}` });
  await expectSame(pool, uploadedOnly.total_sum, "0");
}

export async function expectVendorEscapes(pool: Pool, seed: StatisticsSeed): Promise<void> {
  const percent = await getInvoiceStatisticsAndList(pool, { vendor: "100%" });
  expectId(percent, seed, "percent", true);
  expectId(percent, seed, "thousand", false);
  if (recentRow(percent, seed, "percent").vendor !== "100%") {
    throw new Error("percent vendor was not returned");
  }
  await expectSum(pool, percent.total_sum, null, oracleLikePattern("100%"));
  const all = await getInvoiceStatisticsAndList(pool, { status: "all", vendor: "100%" });
  expectId(all, seed, "percent", true);
  expectId(all, seed, "thousand", false);
  await expectWholeCounts(pool, all);
  const underscore = await getInvoiceStatisticsAndList(pool, { vendor: "a_b" });
  expectId(underscore, seed, "underscore", true);
  expectId(underscore, seed, "wild", false);
  const slash = await getInvoiceStatisticsAndList(pool, { vendor: "a\\b" });
  expectId(slash, seed, "slash", true);
  expectId(slash, seed, "noslash", false);
}

export async function expectRecentLimit(pool: Pool, seed: StatisticsSeed, runId: string): Promise<void> {
  const listed = await getInvoiceStatisticsAndList(pool, { vendor: `lim${runId}` });
  const expected = Array.from({ length: 20 }, (_, index) => seededId(seed, `limit-${String(20 - index)}`));
  if (listed.recent.map((row) => row.id).join() !== expected.join()) {
    throw new Error("recent vendor list was not the 20 newest rows");
  }
}

function expectStatus(stats: InvoiceStatistics, seed: StatisticsSeed, key: "uploaded" | "processing" | "completed"): void {
  if (recentRow(stats, seed, key).status !== key) {
    throw new Error(`${key} status was not returned`);
  }
}

function expectId(stats: InvoiceStatistics, seed: StatisticsSeed, key: string, present: boolean): void {
  const found = stats.recent.some((row) => row.id === seededId(seed, key));
  if (found !== present) {
    throw new Error(`vendor filter presence for ${key} was ${String(found)}`);
  }
}

async function expectWholeCounts(pool: Pool, stats: InvoiceStatistics): Promise<void> {
  const oracle = await countInvoices(pool);
  if (
    stats.total_count !== oracle.total_count ||
    stats.uploaded_count !== oracle.uploaded_count ||
    stats.processing_count !== oracle.processing_count ||
    stats.completed_count !== oracle.completed_count ||
    stats.failed_count !== oracle.failed_count
  ) {
    throw new Error("statistics counts did not match the table");
  }
}

async function expectSum(pool: Pool, actual: string, status: string | null, pattern: string | null): Promise<void> {
  await expectSame(pool, actual, await summedAmounts(pool, status, pattern));
}

async function expectSame(pool: Pool, actual: string, expected: string): Promise<void> {
  if (!(await sameNumeric(pool, actual, expected))) {
    throw new Error(`total_sum ${actual} did not match ${expected}`);
  }
}

function recentRow(stats: InvoiceStatistics, seed: StatisticsSeed, key: string): RecentInvoice {
  const found = stats.recent.find((item) => item.id === seededId(seed, key));
  if (found === undefined) {
    throw new Error(`recent list omitted ${key}`);
  }
  return found;
}
