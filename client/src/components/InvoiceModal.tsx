import type { MouseEvent } from "react";
import { displayFileName } from "../format";
import type { InvoiceRow } from "../state/invoices";
import { CompletedInvoice } from "./CompletedInvoice";
import { useInvoiceDetail, type InvoiceDetailState } from "./useInvoiceDetail";

interface InvoiceModalProps {
  readonly row: InvoiceRow;
  readonly onClose: () => void;
}

export function InvoiceModal({ row, onClose }: InvoiceModalProps) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/40 p-4" onClick={onClose}>
      <div
        aria-labelledby="invoice-details-title"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
        onClick={stopDialogClick}
        role="dialog"
      >
        <ModalHeader name={displayFileName(row.original_name)} onClose={onClose} />
        <ModalBody row={row} />
      </div>
    </div>
  );
}

function ModalHeader({ name, onClose }: { readonly name: string; readonly onClose: () => void }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-950" id="invoice-details-title">
          Invoice details
        </h2>
        <p className="mt-1 text-sm text-slate-600">{name}</p>
      </div>
      <button className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium" onClick={onClose} type="button">
        Close
      </button>
    </div>
  );
}

function ModalBody({ row }: { readonly row: InvoiceRow }) {
  if (row.status !== "completed") {
    return <StatusDetails row={row} />;
  }
  return <CompletedDetails id={row.id} />;
}

function CompletedDetails({ id }: { readonly id: string }) {
  const state = useInvoiceDetail(id);
  return <DetailBody state={state} />;
}

function DetailBody({ state }: { readonly state: InvoiceDetailState }) {
  if (state.phase === "loading") {
    return <p>Loading invoice details…</p>;
  }
  if (state.phase === "error") {
    return <p role="alert">{state.message}</p>;
  }
  if (state.invoice.status !== "completed") {
    return <StatusDetails row={state.invoice} />;
  }
  return <CompletedInvoice invoice={state.invoice} />;
}

function StatusDetails({ row }: { readonly row: InvoiceRow }) {
  return (
    <div className="space-y-2 text-sm text-slate-800">
      <p>{row.status}</p>
      {row.error_message !== null && row.error_message.length > 0 ? <p>{row.error_message}</p> : null}
    </div>
  );
}

function stopDialogClick(event: MouseEvent<HTMLDivElement>): void {
  event.stopPropagation();
}
