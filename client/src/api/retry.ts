import { isRecord } from "./guards";

export type RetryPostResult =
  | { readonly kind: "accepted"; readonly updatedAt: string | undefined }
  | { readonly kind: "conflict" };

export async function postInvoiceRetry(id: string): Promise<RetryPostResult> {
  const response = await fetch(retryPath(id), { method: "POST" });
  if (response.status === 200) {
    const payload: unknown = await response.json();
    return acceptedRetry(payload);
  }
  if (response.status === 409) {
    await response.text();
    return { kind: "conflict" };
  }
  throw new Error(await failureText(response));
}

function retryPath(id: string): string {
  return `/api/invoices/${encodeURIComponent(id)}/retry`;
}

function acceptedRetry(payload: unknown): RetryPostResult {
  if (!isRecord(payload) || payload.success !== true || payload.status !== "uploaded") {
    throw new Error("Retry response did not accept the invoice");
  }
  return { kind: "accepted", updatedAt: readUpdatedAt(payload) };
}

function readUpdatedAt(payload: Record<string, unknown>): string | undefined {
  const stamp = payload.updated_at ?? payload.updatedAt;
  if (stamp === undefined) {
    return undefined;
  }
  if (typeof stamp !== "string" || Number.isNaN(Date.parse(stamp))) {
    throw new Error("Retry response updated_at was not a timestamp");
  }
  return stamp;
}

async function failureText(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  const status = String(response.status);
  if (body.length === 0) {
    return `POST /api/invoices/:id/retry failed with ${status}`;
  }
  return `POST /api/invoices/:id/retry failed with ${status}: ${body}`;
}
