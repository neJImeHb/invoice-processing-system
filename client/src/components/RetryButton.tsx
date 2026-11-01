import type { InvoiceRow } from "../state/invoices";

interface RetryButtonProps {
  readonly className: string;
  readonly pending: boolean;
  readonly row: InvoiceRow;
  readonly onRetry: (row: InvoiceRow) => void;
}

export function RetryButton({ className, pending, row, onRetry }: RetryButtonProps) {
  if (row.status !== "failed") {
    return null;
  }
  return (
    <button
      className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
      disabled={pending}
      onClick={() => {
        if (pending) {
          return;
        }
        onRetry(row);
      }}
      type="button"
    >
      Retry
    </button>
  );
}
