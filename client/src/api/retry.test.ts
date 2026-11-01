import { afterEach, describe, expect, it, vi } from "vitest";
import { postInvoiceRetry } from "./retry";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postInvoiceRetry", () => {
  it("posts to the retry route and reads an optional updated_at", async () => {
    const calls: Array<readonly [string, string | undefined]> = [];
    stubFetch(calls, 200, { success: true, status: "uploaded", updated_at: "2026-10-21T10:00:03.000Z" });

    await expect(postInvoiceRetry("inv 1")).resolves.toEqual({
      kind: "accepted",
      updatedAt: "2026-10-21T10:00:03.000Z",
    });
    expect(calls).toEqual([["/api/invoices/inv%201/retry", "POST"]]);

    stubFetch(calls, 200, { success: true, status: "uploaded" });
    await expect(postInvoiceRetry("inv-1")).resolves.toEqual({ kind: "accepted", updatedAt: undefined });
  });

  it("treats 409 as a conflict and does not throw", async () => {
    stubFetch([], 409, { error: "invoice_not_failed", status: "processing" });
    await expect(postInvoiceRetry("inv-1")).resolves.toEqual({ kind: "conflict" });
  });

  it("throws when the invoice is not accepted", async () => {
    stubFetch([], 503, { error: "broker_unavailable" });
    await expect(postInvoiceRetry("inv-1")).rejects.toThrow(/503/);

    stubFetch([], 200, { success: false });
    await expect(postInvoiceRetry("inv-1")).rejects.toThrow(/did not accept/);
  });
});

function stubFetch(calls: Array<readonly [string, string | undefined]>, status: number, body: unknown): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([String(input), init?.method]);
    return Promise.resolve(jsonResponse(status, body));
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
