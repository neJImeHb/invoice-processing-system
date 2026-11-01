import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { InvoiceStatus } from "../state/invoices";

interface StatusBadgeProps {
  readonly status: InvoiceStatus;
  readonly errorMessage: string | null;
}

export function StatusBadge({ status, errorMessage }: StatusBadgeProps) {
  if (status === "uploaded") {
    return <UploadedBadge />;
  }
  if (status === "processing") {
    return <ProcessingBadge />;
  }
  if (status === "completed") {
    return <CompletedBadge />;
  }
  return <FailedBadge errorMessage={errorMessage} />;
}

function UploadedBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-yellow-100 px-2.5 py-1 text-sm font-medium text-yellow-950">
      <span className="size-2 animate-pulse rounded-full bg-yellow-500" aria-hidden="true" />
      uploaded
    </span>
  );
}

function ProcessingBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-2.5 py-1 text-sm font-medium text-blue-950">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      processing
    </span>
  );
}

function CompletedBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-green-100 px-2.5 py-1 text-sm font-medium text-green-950">
      <Check className="size-4" aria-hidden="true" />
      completed
    </span>
  );
}

function FailedBadge({ errorMessage }: { readonly errorMessage: string | null }) {
  return (
    <span className="inline-flex flex-col items-start gap-1 text-sm text-red-900">
      <span className="inline-flex items-center gap-2 rounded-full bg-red-100 px-2.5 py-1 font-medium">
        <AlertCircle className="size-4" aria-hidden="true" />
        failed
      </span>
      {errorMessage !== null && errorMessage.length > 0 ? <span>{errorMessage}</span> : null}
    </span>
  );
}
