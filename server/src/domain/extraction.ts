import { z } from "zod";

export const InvoiceExtractionSchema = z.object({
  invoiceNumber: z.string().nullable().describe("Official invoice or bill number"),
  vendor: z.object({
    name: z.string().describe("Legal or trading name of the seller/supplier"),
    taxId: z.string().nullable().describe("Tax ID / VAT / USREOU / EIN if present"),
    address: z.string().nullable(),
  }),
  customer: z.object({
    name: z.string().nullable().describe("Recipient / buyer name"),
    taxId: z.string().nullable(),
  }),
  dates: z.object({
    issueDate: z.string().nullable().describe("Date invoice was issued (ISO 8601 YYYY-MM-DD if possible)"),
    dueDate: z.string().nullable().describe("Payment due date"),
  }),
  financials: z.object({
    currency: z.string().default("USD").describe("ISO 3-letter currency code, e.g. USD, EUR, UAH"),
    subtotal: z.number().nullable(),
    taxAmount: z.number().nullable(),
    totalAmount: z.number().describe("Final grand total amount to pay"),
  }),
  lineItems: z
    .array(
      z.object({
        description: z.string().describe("Description of product or service"),
        quantity: z.number().default(1),
        unitPrice: z.number().nullable(),
        totalPrice: z.number().describe("Line item total price"),
      }),
    )
    .default([]),
  normalizedText: z.string().describe(
    "Comprehensive, fully expanded clean plain-text summary of the entire document. " +
      "MANDATORY: Expand all abbreviations (e.g. 'т.д.' -> 'так далі', 'ТОВ' -> 'Товариство з обмеженою відповідальністю', 'Inc.' -> 'Incorporated', 'qty' -> 'quantity'). " +
      "Remove all emojis, decorative symbols, OCR noise, watermarks. Format as structured clean sentences suitable for semantic vector retrieval.",
  ),
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;

export const ProcessInvoiceEventSchema = z.object({
  eventId: z.string().uuid(),
  type: z.literal("PROCESS_INVOICE"),
  invoiceId: z.string().uuid(),
  filePath: z.string().min(1),
  mimeType: z.string().min(1),
  timestamp: z.string(),
});
