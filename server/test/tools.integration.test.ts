delete process.env.GEMINI_API_KEY;

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { createSseHub, type SseHub } from "../src/services/sse.js";
import { composeUp, databaseUrl } from "./health-support.js";
import { watchGoogle, type GoogleWatch } from "./pipeline-support.js";
import {
  assertToolSql,
  expectAmbiguousName,
  expectEmptyVectorSearch,
  expectPlantedChunk,
  expectRetryOutcomes,
  expectVectorLimit,
} from "./tools-action-cases.js";
import { deleteToolInvoices, seedStatistics, type StatisticsSeed } from "./tools-db.js";
import {
  expectCompletedSum,
  expectRecentLimit,
  expectVendorEscapes,
  expectWholeTableCounts,
} from "./tools-stat-cases.js";

const runId = randomUUID();
const createdIds: string[] = [];
let pool: Pool | undefined;
let sse: SseHub | undefined;
let google: GoogleWatch | undefined;
let seed: StatisticsSeed | undefined;

beforeAll(() => startTools());
afterAll(() => stopTools());

describe("statistics tools", () => {
  it("counts the whole table for every status", async () => {
    await expectWholeTableCounts(db(), fixtures(), runId);
  });

  it("sums completed amounts and skips non-numeric totals", async () => {
    await expectCompletedSum(db(), fixtures(), runId);
  });

  it("escapes percent, underscore, and backslash in the vendor filter", async () => {
    await expectVendorEscapes(db(), fixtures());
  });

  it("returns at most 20 newest rows for a vendor", async () => {
    await expectRecentLimit(db(), fixtures(), runId);
  });
});

describe("vector and retry tools", () => {
  it("returns the planted chunk first", async () => {
    await expectPlantedChunk(db(), runId, track);
  });

  it("caps vector search at 10 and defaults to 5", async () => {
    await expectVectorLimit(db(), runId, track);
  });

  it("returns an empty list while a transaction sees no chunks", async () => {
    await expectEmptyVectorSearch(db());
  });

  it("retries a failed id once and rejects a completed id", async () => {
    await expectRetryOutcomes(db(), hub(), runId, track);
  });

  it("returns both ids when one file name matches two rows", async () => {
    await expectAmbiguousName(db(), hub(), runId, track);
  });

  it("keeps tool SQL static", async () => {
    await assertToolSql();
  });
});

async function startTools(): Promise<void> {
  await composeUp();
  google = watchGoogle();
  pool = createPool(databaseUrl);
  sse = createSseHub();
  await migrate(pool);
  seed = await seedStatistics(pool, runId);
  createdIds.push(...seed.idList);
}

async function stopTools(): Promise<void> {
  try {
    if (pool !== undefined) {
      await deleteToolInvoices(pool, createdIds);
    }
    expect(google?.calls() ?? 0).toBe(0);
  } finally {
    google?.restore();
    sse?.close();
    await pool?.end();
  }
}

function db(): Pool {
  if (pool === undefined) {
    throw new Error("postgres pool was not started");
  }
  return pool;
}

function hub(): SseHub {
  if (sse === undefined) {
    throw new Error("sse hub was not started");
  }
  return sse;
}

function fixtures(): StatisticsSeed {
  if (seed === undefined) {
    throw new Error("statistics fixtures were not seeded");
  }
  return seed;
}

function track(id: string): void {
  createdIds.push(id);
}
