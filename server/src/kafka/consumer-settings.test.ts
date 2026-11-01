import { describe, expect, it } from "vitest";
import {
  INVOICE_HEARTBEAT_INTERVAL_MS,
  INVOICE_SESSION_TIMEOUT_MS,
  INVOICE_WORKER_GROUP,
} from "./consumer.js";

describe("invoice consumer settings", () => {
  it("keeps the worker group, a 45 second session, and a sub-second heartbeat", () => {
    expect(INVOICE_WORKER_GROUP).toBe("invoice-processing-workers");
    expect(INVOICE_SESSION_TIMEOUT_MS).toBe(45_000);
    expect(INVOICE_HEARTBEAT_INTERVAL_MS).toBe(500);
    expect(INVOICE_HEARTBEAT_INTERVAL_MS).toBeLessThan(1_000);
    expect(INVOICE_HEARTBEAT_INTERVAL_MS).toBeLessThan(INVOICE_SESSION_TIMEOUT_MS);
  });
});
