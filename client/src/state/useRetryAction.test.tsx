import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryButton } from "../components/RetryButton";
import type { InvoiceRow } from "./invoices";
import { useRetryAction } from "./useRetryAction";

const FAILED_AT = "2026-10-21T10:00:00.000Z";
const PROCESSING_AT = "2026-10-21T10:00:02.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RetryButton", () => {
  it("renders Retry only for a failed invoice and ignores clicks while pending", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<RetryButton className="retry" onRetry={onRetry} pending={false} row={completedRow()} />);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

    rerender(<RetryButton className="retry" onRetry={onRetry} pending={false} row={failedRow(FAILED_AT)} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<RetryButton className="retry" onRetry={onRetry} pending row={failedRow(FAILED_AT)} />);
    const button = screen.getByRole("button", { name: "Retry" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("useRetryAction", () => {
  it("sends one POST and waits for 200 before marking the row uploaded", async () => {
    const calls: string[] = [];
    const retry = deferred<Response>();
    stubFetch(calls, retry);
    const view = renderRetry();
    const row = currentRow(view.result.current.rows);

    act(() => {
      view.result.current.retryFailed(row);
      view.result.current.retryFailed(row);
    });

    expect(calls).toEqual(["POST /api/invoices/inv-retry/retry"]);
    expect(view.result.current.rows[0]?.status).toBe("failed");
    expect(view.result.current.rows[0]?.error_message).toBe("Invoice file is encrypted");
    expect(view.result.current.pendingIds.has("inv-retry")).toBe(true);

    await act(async () => {
      retry.resolve(jsonResponse(200, { success: true, status: "uploaded" }));
    });
    await waitFor(() => {
      expect(view.result.current.rows[0]?.status).toBe("uploaded");
    });
    expect(view.result.current.rows[0]?.error_message).toBeNull();
    expect(view.result.current.rows[0]?.updated_at).toBe(FAILED_AT);
    expect(view.result.current.pendingIds.has("inv-retry")).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("reloads the list once on 409 and does not POST again", async () => {
    const calls: string[] = [];
    const retry = deferred<Response>();
    const list = deferred<Response>();
    stubFetch(calls, retry, list);
    const view = renderRetry();
    const row = currentRow(view.result.current.rows);

    act(() => {
      view.result.current.retryFailed(row);
      view.result.current.retryFailed(row);
    });
    expect(calls).toEqual(["POST /api/invoices/inv-retry/retry"]);

    await act(async () => {
      retry.resolve(jsonResponse(409, { error: "invoice_not_failed", status: "processing" }));
    });
    await waitFor(() => {
      expect(calls).toEqual(["POST /api/invoices/inv-retry/retry", "GET /api/invoices"]);
    });
    expect(view.result.current.rows[0]?.status).toBe("failed");

    list.resolve(jsonResponse(200, [processingRow()]));
    await waitFor(() => {
      expect(view.result.current.rows[0]?.status).toBe("processing");
    });
    expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(1);
  });

  it("leaves the failed row in place when retry is rejected", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(503, { error: "broker_unavailable" })));
    const view = renderRetry();

    act(() => {
      view.result.current.retryFailed(currentRow(view.result.current.rows));
    });
    await waitFor(() => {
      expect(view.result.current.pendingIds.has("inv-retry")).toBe(false);
    });
    expect(view.result.current.rows[0]?.status).toBe("failed");
    expect(view.result.current.rows[0]?.error_message).toBe("Invoice file is encrypted");
    expect(errorSpy).toHaveBeenCalled();
  });
});

function renderRetry() {
  return renderHook(() => {
    const [rows, setRows] = useState<readonly InvoiceRow[]>([failedRow(FAILED_AT)]);
    const action = useRetryAction(setRows);
    return { rows, ...action };
  });
}

function stubFetch(calls: string[], retry: Deferred<Response>, list?: Deferred<Response>): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (method === "POST" && url.endsWith("/retry")) {
      return retry.promise;
    }
    if (method === "GET" && url === "/api/invoices" && list !== undefined) {
      return list.promise;
    }
    return Promise.reject(new Error(`unexpected fetch ${method} ${url}`));
  });
}

function currentRow(rows: readonly InvoiceRow[]): InvoiceRow {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("retry harness lost its row");
  }
  return row;
}

function failedRow(updatedAt: string): InvoiceRow {
  return {
    id: "inv-retry",
    filename: "stored.pdf",
    original_name: "encrypted.pdf",
    mime_type: "application/pdf",
    file_size: 32,
    status: "failed",
    error_message: "Invoice file is encrypted",
    extracted_data: null,
    normalized_text: null,
    created_at: FAILED_AT,
    updated_at: updatedAt,
  };
}

function completedRow(): InvoiceRow {
  return { ...failedRow(FAILED_AT), status: "completed", error_message: null };
}

function processingRow(): InvoiceRow {
  return { ...failedRow(PROCESSING_AT), status: "processing", error_message: null };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
