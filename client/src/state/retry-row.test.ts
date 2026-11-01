import { describe, expect, it } from "vitest";
import { applyStatus, type InvoiceRow } from "./invoices";
import { applyRetryAccepted } from "./retry-row";

const T0 = "2026-10-21T10:00:00.000Z";
const T1 = "2026-10-21T10:00:01.000Z";
const T2 = "2026-10-21T10:00:02.000Z";

describe("applyRetryAccepted", () => {
  it("marks the row uploaded and keeps updated_at when the response has no timestamp", () => {
    const failed = failedRow("inv-1", T0);
    const next = applyRetryAccepted([failed], "inv-1", { updatedAt: undefined, baselineUpdatedAt: T0 });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ status: "uploaded", error_message: null, updated_at: T0 });
    expect(applyStatus(next, { invoiceId: "inv-1", status: "processing", errorMessage: null, updatedAt: T1 })[0]).toMatchObject({
      status: "processing",
      updated_at: T1,
    });
  });

  it("does not move a row back to uploaded after a newer status arrived", () => {
    const failedAgain = failedRow("inv-1", T2);
    const rows = [failedAgain];

    expect(applyRetryAccepted(rows, "inv-1", { updatedAt: undefined, baselineUpdatedAt: T0 })).toBe(rows);
    expect(applyRetryAccepted(rows, "inv-1", { updatedAt: T1, baselineUpdatedAt: T0 })).toBe(rows);
  });

  it("uses a newer updated_at from the response", () => {
    const failed = failedRow("inv-1", T0);
    const other = failedRow("inv-2", T0);
    const next = applyRetryAccepted([failed, other], "inv-1", { updatedAt: T1, baselineUpdatedAt: T0 });

    expect(next[0]).toMatchObject({ id: "inv-1", status: "uploaded", error_message: null, updated_at: T1 });
    expect(next[1]).toBe(other);
  });

  it("leaves the list alone when the id is missing", () => {
    const rows = [failedRow("inv-1", T0)];
    expect(applyRetryAccepted(rows, "missing", { updatedAt: undefined, baselineUpdatedAt: T0 })).toBe(rows);
  });
});

function failedRow(id: string, updatedAt: string): InvoiceRow {
  return {
    id,
    filename: "stored.pdf",
    original_name: "encrypted.pdf",
    mime_type: "application/pdf",
    file_size: 32,
    status: "failed",
    error_message: "Invoice file is encrypted",
    extracted_data: null,
    normalized_text: null,
    created_at: T0,
    updated_at: updatedAt,
  };
}
