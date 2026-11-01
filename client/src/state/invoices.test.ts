import { describe, expect, it } from "vitest";
import {
  applyDeleted,
  applyStatus,
  invoiceFromUpload,
  reconcileWithServer,
  upsertInvoiceRow,
  UPLOAD_ROW_TIMESTAMP,
  type InvoiceRow,
  type InvoiceStatusEvent,
} from "./invoices";

function row(overrides: Partial<InvoiceRow> & Pick<InvoiceRow, "id">): InvoiceRow {
  return {
    filename: "stored.pdf",
    original_name: "invoice.pdf",
    mime_type: "application/pdf",
    file_size: 10,
    status: "uploaded",
    error_message: null,
    extracted_data: null,
    normalized_text: null,
    created_at: "2026-10-21T10:00:00.000Z",
    updated_at: "2026-10-21T10:00:00.000Z",
    ...overrides,
  };
}

function statusEvent(overrides: Partial<InvoiceStatusEvent> & Pick<InvoiceStatusEvent, "invoiceId">): InvoiceStatusEvent {
  return {
    status: "processing",
    errorMessage: null,
    updatedAt: "2026-10-21T10:00:01.000Z",
    ...overrides,
  };
}

describe("applyStatus", () => {
  it("replaces one row and does not insert a second copy of the same id", () => {
    const original = row({ id: "inv-1", status: "uploaded", updated_at: "2026-10-21T10:00:00.000Z" });
    const next = applyStatus(
      [original],
      statusEvent({
        invoiceId: "inv-1",
        status: "failed",
        errorMessage: "Encrypted PDF",
        updatedAt: "2026-10-21T10:00:01.000Z",
      }),
    );

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: "inv-1",
      status: "failed",
      error_message: "Encrypted PDF",
      updated_at: "2026-10-21T10:00:01.000Z",
      original_name: original.original_name,
    });
  });

  it("does not overwrite a row when updatedAt is older or equal", () => {
    const original = row({ id: "inv-1", status: "processing", updated_at: "2026-10-21T10:00:02.000Z" });
    const older = applyStatus([original], statusEvent({ invoiceId: "inv-1", updatedAt: "2026-10-21T10:00:01.000Z" }));
    const equal = applyStatus(
      [original],
      statusEvent({ invoiceId: "inv-1", status: "failed", errorMessage: "nope", updatedAt: original.updated_at }),
    );

    expect(older).toEqual([original]);
    expect(equal).toEqual([original]);
  });

  it("inserts a row when the id is missing", () => {
    const existing = row({ id: "inv-1" });
    const next = applyStatus(
      [existing],
      statusEvent({ invoiceId: "inv-2", status: "uploaded", updatedAt: "2026-10-21T11:00:00.000Z" }),
    );

    expect(next.map((item) => item.id)).toEqual(["inv-2", "inv-1"]);
    expect(next[0]).toMatchObject({
      id: "inv-2",
      status: "uploaded",
      updated_at: "2026-10-21T11:00:00.000Z",
    });
  });
});

describe("applyDeleted", () => {
  it("removes the row for INVOICE_DELETED", () => {
    const first = row({ id: "inv-1" });
    const second = row({ id: "inv-2" });
    expect(applyDeleted([first, second], "inv-1")).toEqual([second]);
  });
});

describe("reconcileWithServer", () => {
  it("keeps a newer local row, takes a newer server row, and drops ids the server omits", () => {
    const localNewer = row({ id: "local-newer", status: "processing", updated_at: "2026-10-21T12:00:00.000Z" });
    const serverOlder = row({ id: "local-newer", status: "uploaded", updated_at: "2026-10-21T11:00:00.000Z" });
    const localOlder = row({
      id: "server-newer",
      status: "uploaded",
      updated_at: "2026-10-21T11:00:00.000Z",
      original_name: "local.pdf",
    });
    const serverNewer = row({
      id: "server-newer",
      status: "completed",
      updated_at: "2026-10-21T12:00:00.000Z",
      original_name: "server.pdf",
    });
    const onlyLocal = row({ id: "gone" });
    const onlyServer = row({ id: "added", original_name: "new.pdf" });

    expect(reconcileWithServer([localNewer, localOlder, onlyLocal], [serverOlder, serverNewer, onlyServer])).toEqual([
      localNewer,
      serverNewer,
      onlyServer,
    ]);
  });
});

describe("invoiceFromUpload", () => {
  it("uses the epoch updated_at so a later status event replaces the upload", () => {
    const placeholder = invoiceFromUpload(
      { id: "inv-1", filename: "acme.pdf", status: "uploaded" },
      { size: 40, type: "application/pdf" },
    );

    expect(placeholder.created_at).toBe(UPLOAD_ROW_TIMESTAMP);
    expect(placeholder.updated_at).toBe("1970-01-01T00:00:00.000Z");
    expect(placeholder).toMatchObject({
      original_name: "acme.pdf",
      filename: "acme.pdf",
      file_size: 40,
      status: "uploaded",
      error_message: null,
      extracted_data: null,
    });

    const next = applyStatus(
      upsertInvoiceRow([], placeholder),
      statusEvent({ invoiceId: "inv-1", status: "processing", updatedAt: "2026-10-21T10:00:01.000Z" }),
    );

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      status: "processing",
      original_name: "acme.pdf",
      filename: "acme.pdf",
      file_size: 40,
      updated_at: "2026-10-21T10:00:01.000Z",
    });
  });
});
