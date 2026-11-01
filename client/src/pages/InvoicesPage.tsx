import { useState } from "react";
import { DeleteDialog } from "../components/DeleteDialog";
import { InvoiceModal } from "../components/InvoiceModal";
import { InvoiceTable } from "../components/InvoiceTable";
import { UploadDropzone } from "../components/UploadDropzone";
import { displayFileName } from "../format";
import type { InvoiceRow } from "../state/invoices";
import type { InvoiceLoadPhase } from "../state/useInvoiceStream";
import { useDeleteFlow, type DeleteFlow } from "./useDeleteFlow";

interface InvoicesPageProps {
  readonly rows: readonly InvoiceRow[];
  readonly phase: InvoiceLoadPhase;
  readonly retryPendingIds: ReadonlySet<string>;
  readonly onUploaded: (row: InvoiceRow) => void;
  readonly onDeleted: (invoiceId: string) => void;
  readonly onRetry: (row: InvoiceRow) => void;
}

export function InvoicesPage({ rows, phase, retryPendingIds, onUploaded, onDeleted, onRetry }: InvoicesPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const deletion = useDeleteFlow(rows, (invoiceId) => {
    setSelectedId((current) => (current === invoiceId ? null : current));
    onDeleted(invoiceId);
  });
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-950">Invoices</h1>
      <ReadyDropzone onUploaded={onUploaded} phase={phase} />
      <InvoiceList
        onDelete={deletion.ask}
        onRetry={onRetry}
        onView={setSelectedId}
        phase={phase}
        retryPendingIds={retryPendingIds}
        rows={rows}
      />
      <DetailDialog onClose={() => setSelectedId(null)} row={findRow(rows, selectedId)} />
      <DeletePrompt deletion={deletion} />
    </section>
  );
}

function ReadyDropzone({
  phase,
  onUploaded,
}: {
  readonly phase: InvoiceLoadPhase;
  readonly onUploaded: (row: InvoiceRow) => void;
}) {
  if (phase !== "ready") {
    return null;
  }
  return <UploadDropzone onUploaded={onUploaded} />;
}

interface InvoiceListProps {
  readonly rows: readonly InvoiceRow[];
  readonly phase: InvoiceLoadPhase;
  readonly retryPendingIds: ReadonlySet<string>;
  readonly onView: (invoiceId: string) => void;
  readonly onDelete: (row: InvoiceRow) => void;
  readonly onRetry: (row: InvoiceRow) => void;
}

function InvoiceList({ rows, phase, retryPendingIds, onView, onDelete, onRetry }: InvoiceListProps) {
  if (phase === "loading") {
    return <p>Loading invoices…</p>;
  }
  if (phase === "error") {
    return <p>Could not load invoices.</p>;
  }
  if (rows.length === 0) {
    return <p>Upload an invoice to see it here.</p>;
  }
  return (
    <InvoiceTable
      onDelete={onDelete}
      onRetry={onRetry}
      onView={onView}
      retryPendingIds={retryPendingIds}
      rows={rows}
    />
  );
}

function DetailDialog({ row, onClose }: { readonly row: InvoiceRow | null; readonly onClose: () => void }) {
  if (row === null) {
    return null;
  }
  return <InvoiceModal onClose={onClose} row={row} />;
}

function DeletePrompt({ deletion }: { readonly deletion: DeleteFlow }) {
  if (deletion.pending === null) {
    return null;
  }
  return (
    <DeleteDialog
      error={deletion.error}
      filename={displayFileName(deletion.pending.original_name)}
      onCancel={deletion.cancel}
      onConfirm={deletion.confirm}
      pending={deletion.busy}
    />
  );
}

function findRow(rows: readonly InvoiceRow[], id: string | null): InvoiceRow | null {
  if (id === null) {
    return null;
  }
  return rows.find((row) => row.id === id) ?? null;
}
