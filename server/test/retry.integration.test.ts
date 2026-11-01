delete process.env.GEMINI_API_KEY;

import { afterAll, beforeAll, describe, it } from "vitest";
import {
  expectParallelRetry,
  expectRejectedStatuses,
  expectKeptRetry,
  expectSingleRetry,
  expectUnknownId,
} from "./retry-scenarios.js";
import { startRetrySuite, type RetrySuite } from "./retry-suite.js";

describe("invoice retry", () => {
  let suite: RetrySuite | undefined;

  beforeAll(async () => {
    suite = await startRetrySuite();
  }, 300_000);

  afterAll(async () => {
    await suite?.stop();
  });

  it("queues a failed invoice once", async () => {
    await expectSingleRetry(requiredSuite(suite));
  });

  it("rejects retry unless the invoice failed", async () => {
    await expectRejectedStatuses(requiredSuite(suite));
  });

  it("returns 404 for an unknown or malformed id", async () => {
    await expectUnknownId(requiredSuite(suite));
  });

  it("accepts only one of two parallel retries", async () => {
    await expectParallelRetry(requiredSuite(suite));
  });

  it("keeps the uploaded retry when publish throws", async () => {
    await expectKeptRetry(requiredSuite(suite));
  });
});

function requiredSuite(suite: RetrySuite | undefined): RetrySuite {
  if (suite === undefined) {
    throw new Error("retry suite was not started");
  }
  return suite;
}
