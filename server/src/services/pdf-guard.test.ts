import { describe, expect, it } from "vitest";
import { pdfBytes } from "../../test/upload-bytes.js";
import { guardInvoiceBytes } from "./pdf-guard.js";

describe("guardInvoiceBytes", () => {
  it("rejects pdfBytes plus an /Encrypt marker", () => {
    const bytes = Buffer.concat([pdfBytes(), Buffer.from("\n/Encrypt")]);
    expect(guardInvoiceBytes(bytes, "application/pdf")).toMatchObject({
      ok: false,
      errorMessage: expect.stringMatching(/encrypted/i),
    });
  });

  it("accepts pdfBytes", () => {
    expect(guardInvoiceBytes(pdfBytes(), "application/pdf")).toEqual({ ok: true });
  });

  it("rejects a PDF truncated before %%EOF", () => {
    expect(guardInvoiceBytes(Buffer.from("%PDF-1.4\n"), "application/pdf")).toMatchObject({
      ok: false,
      errorMessage: expect.stringMatching(/unreadable/i),
    });
  });

  it("rejects an empty file as unreadable", () => {
    expect(guardInvoiceBytes(new Uint8Array(), "application/pdf")).toMatchObject({
      ok: false,
      errorMessage: expect.stringMatching(/unreadable/i),
    });
  });
});
