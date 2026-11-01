import { InvoiceExtractionSchema, type InvoiceExtraction } from "../domain/extraction.js";
import { EMBEDDING_DIMENSIONS, type InvoiceEmbedder } from "./embedder.js";
import type { InvoiceExtractor } from "./extractor.js";

const FIXED_EXTRACTION = {
  invoiceNumber: "INV-100",
  vendor: { name: "Northwind", taxId: null, address: null },
  customer: { name: null, taxId: null },
  dates: { issueDate: null, dueDate: null },
  financials: { currency: "USD", subtotal: null, taxAmount: null, totalAmount: 120 },
  lineItems: [
    {
      description: "cloud hosting subscription",
      quantity: 1,
      unitPrice: null,
      totalPrice: 120,
    },
  ],
  normalizedText: "Invoice INV-100 from Northwind for a cloud hosting subscription. Total amount 120 USD.",
};

export interface FakeExtractor extends InvoiceExtractor {
  readonly calls: number;
}

export interface FakeEmbedder extends InvoiceEmbedder {
  readonly calls: number;
}

export function createFakeExtractor(): FakeExtractor {
  const state = { calls: 0 };
  return {
    get calls(): number {
      return state.calls;
    },
    extract(input: { bytes: Uint8Array; mimeType: string }): Promise<InvoiceExtraction> {
      void input;
      state.calls += 1;
      return Promise.resolve(InvoiceExtractionSchema.parse(FIXED_EXTRACTION));
    },
  };
}

export function fakeEmbed(text: string): number[] {
  const raw: number[] = [];
  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    raw.push(embeddingComponent(text, index));
  }
  return normalize(raw);
}

export function createFakeEmbedder(): FakeEmbedder {
  const state = { calls: 0 };
  return {
    get calls(): number {
      return state.calls;
    },
    embed(text: string): Promise<readonly number[]> {
      state.calls += 1;
      return Promise.resolve(fakeEmbed(text));
    },
  };
}

function embeddingComponent(text: string, index: number): number {
  let hash = 2166136261 ^ Math.imul(index + 1, 0x85ebca6b);
  for (let cursor = 0; cursor < text.length; cursor += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(cursor), 16777619);
  }
  hash ^= Math.imul(index + 17, 2246822507);
  const signed = ((hash >>> 0) % 2000) - 1000;
  if (signed === 0) {
    return index % 2 === 0 ? 1 : -1;
  }
  return signed;
}

function normalize(values: readonly number[]): number[] {
  let sumSquares = 0;
  for (const value of values) {
    sumSquares += value * value;
  }
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) {
    throw new Error("Fake embedding norm was zero");
  }
  return values.map((value) => value / magnitude);
}
