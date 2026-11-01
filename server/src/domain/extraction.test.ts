import { describe, expect, it } from "vitest";
import { InvoiceExtractionSchema, ProcessInvoiceEventSchema } from "./extraction.js";

const validEvent = {
  eventId: "8c2e0c0a-4b1e-4f0a-9a1c-6d5e4f3a2b10",
  type: "PROCESS_INVOICE" as const,
  invoiceId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  filePath: "C:/uploads/a.pdf",
  mimeType: "application/pdf",
  timestamp: "2026-10-21T10:00:00.000Z",
};

const extraction = {
  invoiceNumber: null,
  vendor: { name: "A", taxId: null, address: null },
  customer: { name: null, taxId: null },
  dates: { issueDate: null, dueDate: null },
  financials: { subtotal: null, taxAmount: null, totalAmount: 1 },
  normalizedText: "text",
};

describe("InvoiceExtractionSchema", () => {
  it("keeps nulls and applies the written defaults", () => {
    const parsed = InvoiceExtractionSchema.parse(extraction);
    expect(parsed.invoiceNumber).toBeNull();
    expect(parsed.financials.currency).toBe("USD");
    expect(parsed.lineItems).toEqual([]);
    const withLine = InvoiceExtractionSchema.parse({
      ...extraction,
      lineItems: [{ description: "item", unitPrice: null, totalPrice: 1 }],
    });
    expect(withLine.lineItems[0]?.quantity).toBe(1);
  });

  it("rejects an object that is missing the grand total", () => {
    expect(() => InvoiceExtractionSchema.parse({})).toThrow();
  });
});

describe("ProcessInvoiceEventSchema", () => {
  it("accepts the job payload and drops originalName", () => {
    const parsed = ProcessInvoiceEventSchema.parse({ ...validEvent, originalName: "secret.pdf" });
    expect(parsed).toEqual(validEvent);
    expect(Object.hasOwn(parsed, "originalName")).toBe(false);
  });

  it("rejects an empty path and a non-uuid event id", () => {
    expect(ProcessInvoiceEventSchema.safeParse({ ...validEvent, filePath: "" }).success).toBe(false);
    expect(ProcessInvoiceEventSchema.safeParse({ ...validEvent, eventId: "evt_1" }).success).toBe(false);
    expect(ProcessInvoiceEventSchema.safeParse({ ...validEvent, mimeType: "" }).success).toBe(false);
  });
});
