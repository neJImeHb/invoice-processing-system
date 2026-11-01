import { FileText } from "lucide-react";
import { displayFileName, formatFileSize, formatUploadDate } from "../format";
import type { InvoiceRow } from "../state/invoices";
import { readExtractedSummary } from "./extracted-summary";
import { RetryButton } from "./RetryButton";
import { StatusBadge } from "./StatusBadge";

interface InvoiceTableProps {
  readonly rows: readonly InvoiceRow[];
  readonly retryPendingIds: ReadonlySet<string>;
  readonly onView: (invoiceId: string) => void;
  readonly onDelete: (row: InvoiceRow) => void;
  readonly onRetry: (row: InvoiceRow) => void;
}

const actionClass =
  "rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-800 hover:bg-slate-50";

export function InvoiceTable({ rows, retryPendingIds, onView, onDelete, onRetry }: InvoiceTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-3 font-medium" scope="col">
              File
            </th>
            <th className="px-3 py-3 font-medium" scope="col">
              Filename
            </th>
            <th className="px-3 py-3 font-medium" scope="col">
              Upload date
            </th>
            <th className="px-3 py-3 font-medium" scope="col">
              File size
            </th>
            <th className="px-3 py-3 font-medium" scope="col">
              Status
            </th>
            <th className="px-3 py-3 font-medium" scope="col">
              Extracted summary
            </th>
            <th className="px-3 py-3 font-medium" scope="col">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <InvoiceTableRow
              key={row.id}
              onDelete={onDelete}
              onRetry={onRetry}
              onView={onView}
              pendingRetry={retryPendingIds.has(row.id)}
              row={row}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceTableRow({
  row,
  pendingRetry,
  onView,
  onDelete,
  onRetry,
}: {
  readonly row: InvoiceRow;
  readonly pendingRetry: boolean;
  readonly onView: (invoiceId: string) => void;
  readonly onDelete: (row: InvoiceRow) => void;
  readonly onRetry: (row: InvoiceRow) => void;
}) {
  const summary = readExtractedSummary(row.extracted_data);
  return (
    <tr className="border-t border-slate-200">
      <td className="px-3 py-3">
        <FileText aria-hidden="true" className="size-5 text-slate-500" />
      </td>
      <td className="px-3 py-3 font-medium text-slate-900">{displayFileName(row.original_name)}</td>
      <td className="px-3 py-3 text-slate-700">{formatUploadDate(row.created_at)}</td>
      <td className="px-3 py-3 text-slate-700">{formatFileSize(row.file_size)}</td>
      <td className="px-3 py-3">
        <StatusBadge errorMessage={row.error_message} status={row.status} />
      </td>
      <td className="px-3 py-3 text-slate-700">{summary ?? ""}</td>
      <td className="px-3 py-3">
        <RowActions onDelete={onDelete} onRetry={onRetry} onView={onView} pendingRetry={pendingRetry} row={row} />
      </td>
    </tr>
  );
}

function RowActions({
  row,
  pendingRetry,
  onView,
  onDelete,
  onRetry,
}: {
  readonly row: InvoiceRow;
  readonly pendingRetry: boolean;
  readonly onView: (invoiceId: string) => void;
  readonly onDelete: (row: InvoiceRow) => void;
  readonly onRetry: (row: InvoiceRow) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button className={actionClass} onClick={() => onView(row.id)} type="button">
        View details
      </button>
      <button className={actionClass} onClick={() => onDelete(row)} type="button">
        Delete
      </button>
      <RetryButton className={actionClass} onRetry={onRetry} pending={pendingRetry} row={row} />
    </div>
  );
}
