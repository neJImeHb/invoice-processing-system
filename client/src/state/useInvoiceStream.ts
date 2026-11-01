import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { INVOICE_EVENTS_PATH, parseDeletedInvoiceId, parseStatusChange } from "../api/events";
import { fetchInvoices } from "../api/invoices";
import { applyDeleted, applyStatus, reconcileWithServer, upsertInvoiceRow, type InvoiceRow } from "./invoices";
import { useRetryAction } from "./useRetryAction";

export type InvoiceLoadPhase = "loading" | "ready" | "error";

export interface InvoiceStream {
  readonly rows: readonly InvoiceRow[];
  readonly phase: InvoiceLoadPhase;
  readonly upsertInvoice: (row: InvoiceRow) => void;
  readonly removeInvoice: (invoiceId: string) => void;
  readonly retryFailed: (row: InvoiceRow) => void;
  readonly retryPendingIds: ReadonlySet<string>;
}

export function useInvoiceStream(): InvoiceStream {
  const [rows, setRows] = useState<readonly InvoiceRow[]>([]);
  const [phase, setPhase] = useState<InvoiceLoadPhase>("loading");
  useEffect(() => subscribeToInvoices(setRows, setPhase), []);
  return useStreamActions(rows, phase, setRows);
}

function useStreamActions(
  rows: readonly InvoiceRow[],
  phase: InvoiceLoadPhase,
  setRows: Dispatch<SetStateAction<readonly InvoiceRow[]>>,
): InvoiceStream {
  const retry = useRetryAction(setRows);
  const upsertInvoice = useCallback(
    (row: InvoiceRow) => {
      setRows((current) => upsertInvoiceRow(current, row));
    },
    [setRows],
  );
  const removeInvoice = useCallback(
    (invoiceId: string) => {
      setRows((current) => applyDeleted(current, invoiceId));
    },
    [setRows],
  );
  return {
    rows,
    phase,
    upsertInvoice,
    removeInvoice,
    retryFailed: retry.retryFailed,
    retryPendingIds: retry.pendingIds,
  };
}

function subscribeToInvoices(
  setRows: Dispatch<SetStateAction<readonly InvoiceRow[]>>,
  setPhase: Dispatch<SetStateAction<InvoiceLoadPhase>>,
): () => void {
  let active = true;
  let opened = false;
  const source = new EventSource(INVOICE_EVENTS_PATH);
  const isActive = (): boolean => active;

  source.addEventListener("open", () => {
    if (!opened) {
      opened = true;
      return;
    }
    loadInvoiceList(false, isActive, setRows, setPhase);
  });
  source.addEventListener("INVOICE_STATUS_CHANGED", (event) => {
    handleStatusEvent(event, setRows);
  });
  source.addEventListener("INVOICE_DELETED", (event) => {
    handleDeletedEvent(event, setRows);
  });
  loadInvoiceList(true, isActive, setRows, setPhase);

  return () => {
    active = false;
    source.close();
  };
}

function loadInvoiceList(
  initial: boolean,
  isActive: () => boolean,
  setRows: Dispatch<SetStateAction<readonly InvoiceRow[]>>,
  setPhase: Dispatch<SetStateAction<InvoiceLoadPhase>>,
): void {
  fetchInvoices()
    .then((serverRows) => {
      if (!isActive()) {
        return;
      }
      setRows((local) => reconcileWithServer(local, serverRows));
      setPhase("ready");
    })
    .catch((error: unknown) => {
      console.error(error);
      if (!isActive() || !initial) {
        return;
      }
      setPhase("error");
    });
}

function handleStatusEvent(event: Event, setRows: Dispatch<SetStateAction<readonly InvoiceRow[]>>): void {
  const data = messageData(event);
  if (data === undefined) {
    return;
  }
  try {
    const change = parseStatusChange(data);
    flushSync(() => {
      setRows((rows) => applyStatus(rows, change));
    });
  } catch (error) {
    console.error(error);
  }
}

function handleDeletedEvent(event: Event, setRows: Dispatch<SetStateAction<readonly InvoiceRow[]>>): void {
  const data = messageData(event);
  if (data === undefined) {
    return;
  }
  try {
    const invoiceId = parseDeletedInvoiceId(data);
    setRows((rows) => applyDeleted(rows, invoiceId));
  } catch (error) {
    console.error(error);
  }
}

function messageData(event: Event): string | undefined {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    return undefined;
  }
  return event.data;
}
