import type { MouseEvent } from "react";

interface DeleteDialogProps {
  readonly filename: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly error?: string | null;
  readonly pending?: boolean;
}

export function DeleteDialog({ filename, onCancel, onConfirm, error = null, pending = false }: DeleteDialogProps) {
  const label = filename.length > 0 ? filename : "this invoice";
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onClick={onCancel}>
      <div
        aria-labelledby="delete-invoice-title"
        aria-modal="true"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
        onClick={stopDialogClick}
        role="alertdialog"
      >
        <h2 className="text-lg font-semibold text-slate-950" id="delete-invoice-title">
          Delete {label}?
        </h2>
        <p className="mt-2 text-sm text-slate-700">This removes the invoice, its extracted data, and the file.</p>
        <DeleteError error={error} />
        <DialogActions onCancel={onCancel} onConfirm={onConfirm} pending={pending} />
      </div>
    </div>
  );
}

function DeleteError({ error }: { readonly error: string | null }) {
  if (error === null) {
    return null;
  }
  return (
    <p className="mt-3 text-sm font-medium text-red-700" role="alert">
      {error}
    </p>
  );
}

function DialogActions({
  pending,
  onCancel,
  onConfirm,
}: {
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div className="mt-6 flex justify-end gap-3">
      <button
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 disabled:opacity-50"
        disabled={pending}
        onClick={onCancel}
        type="button"
      >
        Cancel
      </button>
      <button
        aria-busy={pending}
        className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        disabled={pending}
        onClick={onConfirm}
        type="button"
      >
        Confirm delete
      </button>
    </div>
  );
}

function stopDialogClick(event: MouseEvent<HTMLDivElement>): void {
  event.stopPropagation();
}
