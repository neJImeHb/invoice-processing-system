import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { fetchInvoices } from "../api/invoices";
import { postInvoiceRetry } from "../api/retry";
import { reconcileWithServer, type InvoiceRow } from "./invoices";
import { applyRetryAccepted } from "./retry-row";

export interface RetryAction {
  readonly pendingIds: ReadonlySet<string>;
  readonly retryFailed: (row: InvoiceRow) => void;
}

type RowDispatch = Dispatch<SetStateAction<readonly InvoiceRow[]>>;
type PendingDispatch = Dispatch<SetStateAction<ReadonlySet<string>>>;

export function useRetryAction(setRows: RowDispatch): RetryAction {
  const pendingRef = useRef<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const retryFailed = useCallback(
    (row: InvoiceRow) => {
      beginRetry(row, pendingRef, setPendingIds, setRows);
    },
    [setRows],
  );
  return { pendingIds, retryFailed };
}

function beginRetry(row: InvoiceRow, pendingRef: RefObject<Set<string>>, setPendingIds: PendingDispatch, setRows: RowDispatch): void {
  const pending = pendingRef.current;
  if (pending === null || row.status !== "failed" || pending.has(row.id)) {
    return;
  }
  pending.add(row.id);
  setPendingIds(new Set(pending));
  void settleRetry(row, pendingRef, setPendingIds, setRows);
}

async function settleRetry(
  row: InvoiceRow,
  pendingRef: RefObject<Set<string>>,
  setPendingIds: PendingDispatch,
  setRows: RowDispatch,
): Promise<void> {
  try {
    await applyRetryResponse(row, setRows);
  } catch (error) {
    console.error(error);
  } finally {
    releaseRetry(row.id, pendingRef, setPendingIds);
  }
}

async function applyRetryResponse(row: InvoiceRow, setRows: RowDispatch): Promise<void> {
  const outcome = await postInvoiceRetry(row.id);
  if (outcome.kind === "accepted") {
    flushSync(() => {
      setRows((current) =>
        applyRetryAccepted(current, row.id, {
          updatedAt: outcome.updatedAt,
          baselineUpdatedAt: row.updated_at,
        }),
      );
    });
    return;
  }
  const serverRows = await fetchInvoices();
  setRows((current) => reconcileWithServer(current, serverRows));
}

function releaseRetry(invoiceId: string, pendingRef: RefObject<Set<string>>, setPendingIds: PendingDispatch): void {
  const pending = pendingRef.current;
  if (pending === null || !pending.has(invoiceId)) {
    return;
  }
  pending.delete(invoiceId);
  setPendingIds(new Set(pending));
}
