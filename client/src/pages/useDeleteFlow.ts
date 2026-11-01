import { useEffect, useState } from "react";
import { deleteInvoice } from "../api/invoices";
import type { InvoiceRow } from "../state/invoices";

export interface DeleteFlow {
  readonly pending: InvoiceRow | null;
  readonly error: string | null;
  readonly busy: boolean;
  readonly ask: (row: InvoiceRow) => void;
  readonly cancel: () => void;
  readonly confirm: () => void;
}

interface DeleteListeners {
  readonly onDeleted: (invoiceId: string) => void;
  readonly clearPending: () => void;
  readonly setError: (message: string | null) => void;
  readonly setBusy: (busy: boolean) => void;
}

export function useDeleteFlow(rows: readonly InvoiceRow[], onDeleted: (invoiceId: string) => void): DeleteFlow {
  const [pending, setPending] = useState<InvoiceRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    forgetMissing(pending, rows, () => {
      setPending(null);
      setError(null);
    });
  }, [pending, rows]);
  return {
    pending,
    error,
    busy,
    ask: (row) => {
      askToDelete(busy, row, setPending, setError);
    },
    cancel: () => {
      cancelDelete(busy, setPending, setError);
    },
    confirm: () => {
      confirmDelete(pending, busy, setBusy, {
        onDeleted,
        clearPending: () => {
          setPending(null);
        },
        setError,
        setBusy,
      });
    },
  };
}

function forgetMissing(pending: InvoiceRow | null, rows: readonly InvoiceRow[], reset: () => void): void {
  if (pending !== null && !rows.some((row) => row.id === pending.id)) {
    reset();
  }
}

function askToDelete(
  busy: boolean,
  row: InvoiceRow,
  setPending: (next: InvoiceRow | null) => void,
  setError: (message: string | null) => void,
): void {
  if (busy) {
    return;
  }
  setError(null);
  setPending(row);
}

function cancelDelete(
  busy: boolean,
  setPending: (next: InvoiceRow | null) => void,
  setError: (message: string | null) => void,
): void {
  if (busy) {
    return;
  }
  setPending(null);
  setError(null);
}

function confirmDelete(
  pending: InvoiceRow | null,
  busy: boolean,
  setBusy: (next: boolean) => void,
  listeners: DeleteListeners,
): void {
  if (pending === null || busy) {
    return;
  }
  setBusy(true);
  void runDelete(pending, listeners);
}

function runDelete(row: InvoiceRow, listeners: DeleteListeners): Promise<void> {
  return deleteInvoice(row.id)
    .then(() => {
      listeners.onDeleted(row.id);
      listeners.clearPending();
      listeners.setError(null);
    })
    .catch((error: unknown) => {
      console.error(error);
      listeners.setError(errorText(error));
    })
    .finally(() => {
      listeners.setBusy(false);
    });
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Could not delete the invoice.";
}
