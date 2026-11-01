import { isStrictlyNewer, type InvoiceRow } from "./invoices";

export interface RetryAccepted {
  readonly updatedAt: string | undefined;
  readonly baselineUpdatedAt: string;
}

/** Keeps `updated_at` when the response has none, so a later SSE timestamp still wins. */
export function applyRetryAccepted(
  rows: readonly InvoiceRow[],
  invoiceId: string,
  accepted: RetryAccepted,
): readonly InvoiceRow[] {
  const index = rows.findIndex((row) => row.id === invoiceId);
  if (index === -1) {
    return rows;
  }
  const current = rows[index];
  if (current === undefined) {
    return rows;
  }
  const updatedAt = nextTimestamp(current, accepted);
  if (updatedAt === undefined) {
    return rows;
  }
  const next = rows.slice();
  next[index] = { ...current, status: "uploaded", error_message: null, updated_at: updatedAt };
  return next;
}

function nextTimestamp(current: InvoiceRow, accepted: RetryAccepted): string | undefined {
  if (accepted.updatedAt !== undefined) {
    if (!isStrictlyNewer(accepted.updatedAt, current.updated_at)) {
      return undefined;
    }
    return accepted.updatedAt;
  }
  if (current.updated_at !== accepted.baselineUpdatedAt) {
    return undefined;
  }
  return current.updated_at;
}
