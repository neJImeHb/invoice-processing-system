export const INVOICE_STATUSES = ["uploaded", "processing", "completed", "failed"] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceRow {
  readonly id: string;
  readonly filename: string;
  readonly original_name: string;
  readonly mime_type: string;
  readonly file_size: number;
  readonly status: InvoiceStatus;
  readonly error_message: string | null;
  readonly extracted_data: unknown;
  readonly normalized_text: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Epoch keeps a later server `updatedAt` strictly newer than this placeholder. */
export const UPLOAD_ROW_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export interface UploadAcceptance {
  readonly id: string;
  readonly filename: string;
  readonly status: "uploaded";
}

export interface UploadedFileInfo {
  readonly size: number;
  readonly type: string;
}

export interface InvoiceStatusEvent {
  readonly invoiceId: string;
  readonly status: InvoiceStatus;
  readonly errorMessage: string | null;
  readonly updatedAt: string;
}

export function isInvoiceStatus(value: string): value is InvoiceStatus {
  return INVOICE_STATUSES.some((status) => status === value);
}

export function applyStatus(rows: readonly InvoiceRow[], event: InvoiceStatusEvent): readonly InvoiceRow[] {
  const index = rows.findIndex((row) => row.id === event.invoiceId);
  if (index === -1) {
    return [rowFromStatus(event), ...rows];
  }
  const current = rows[index];
  if (current === undefined || !isStrictlyNewer(event.updatedAt, current.updated_at)) {
    return rows;
  }
  const next = rows.slice();
  next[index] = {
    ...current,
    status: event.status,
    error_message: event.errorMessage,
    updated_at: event.updatedAt,
  };
  return next;
}

export function invoiceFromUpload(acceptance: UploadAcceptance, file: UploadedFileInfo): InvoiceRow {
  return {
    id: acceptance.id,
    filename: acceptance.filename,
    original_name: acceptance.filename,
    mime_type: file.type,
    file_size: file.size,
    status: acceptance.status,
    error_message: null,
    extracted_data: null,
    normalized_text: null,
    created_at: UPLOAD_ROW_TIMESTAMP,
    updated_at: UPLOAD_ROW_TIMESTAMP,
  };
}

export function upsertInvoiceRow(rows: readonly InvoiceRow[], incoming: InvoiceRow): readonly InvoiceRow[] {
  const index = rows.findIndex((row) => row.id === incoming.id);
  if (index === -1) {
    return [incoming, ...rows];
  }
  const current = rows[index];
  if (current === undefined) {
    return [incoming, ...rows];
  }
  const next = rows.slice();
  next[index] = mergeUploadedRow(current, incoming);
  return next;
}

export function applyDeleted(rows: readonly InvoiceRow[], invoiceId: string): readonly InvoiceRow[] {
  if (!rows.some((row) => row.id === invoiceId)) {
    return rows;
  }
  return rows.filter((row) => row.id !== invoiceId);
}

export function reconcileWithServer(local: readonly InvoiceRow[], server: readonly InvoiceRow[]): InvoiceRow[] {
  return server.map((serverRow) => preferNewerLocal(local, serverRow));
}

function preferNewerLocal(local: readonly InvoiceRow[], serverRow: InvoiceRow): InvoiceRow {
  const localRow = local.find((row) => row.id === serverRow.id);
  if (localRow !== undefined && isStrictlyNewer(localRow.updated_at, serverRow.updated_at)) {
    return localRow;
  }
  return serverRow;
}

function rowFromStatus(event: InvoiceStatusEvent): InvoiceRow {
  return {
    id: event.invoiceId,
    filename: "",
    original_name: "",
    mime_type: "",
    file_size: 0,
    status: event.status,
    error_message: event.errorMessage,
    extracted_data: null,
    normalized_text: null,
    created_at: event.updatedAt,
    updated_at: event.updatedAt,
  };
}

function mergeUploadedRow(current: InvoiceRow, incoming: InvoiceRow): InvoiceRow {
  if (!isStrictlyNewer(current.updated_at, incoming.updated_at)) {
    return incoming;
  }
  return {
    ...incoming,
    status: current.status,
    error_message: current.error_message,
    extracted_data: current.extracted_data,
    normalized_text: current.normalized_text,
    created_at: current.created_at,
    updated_at: current.updated_at,
  };
}

export function isStrictlyNewer(candidate: string, current: string): boolean {
  const next = Date.parse(candidate);
  const previous = Date.parse(current);
  if (Number.isNaN(next) || Number.isNaN(previous)) {
    return false;
  }
  return next > previous;
}
