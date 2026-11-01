import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, type PDFStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  SAMPLE_INVOICE_RELATIVE_PATH,
  SAMPLE_LINE_DESCRIPTION,
  SAMPLE_TOTAL,
  SAMPLE_VENDOR,
  sampleInvoiceLines,
  writeSampleInvoice,
} from "./sample-invoice.js";

describe("sample invoice", () => {
  it("draws the vendor, the hosting line, and the total from one source", () => {
    expect(SAMPLE_VENDOR).toBe("Northwind Supplies");
    expect(SAMPLE_LINE_DESCRIPTION).toBe("cloud hosting subscription");
    expect(SAMPLE_TOTAL).toBe("120.00");
    const lines = sampleInvoiceLines().join("\n");
    expect(lines).toContain(SAMPLE_VENDOR);
    expect(sampleInvoiceLines()).toContain(SAMPLE_LINE_DESCRIPTION);
    expect(lines).toContain(SAMPLE_TOTAL);
  });

  it("writes a non-empty one-page PDF containing those strings", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sample-invoice-"));
    try {
      const filePath = path.join(dir, "invoice.pdf");
      await writeSampleInvoice(filePath);
      const bytes = await readFile(filePath);
      expect(bytes.byteLength).toBeGreaterThan(0);
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      const text = await pageText(bytes);
      expect(text).toContain(SAMPLE_VENDOR);
      expect(text).toContain(SAMPLE_LINE_DESCRIPTION);
      expect(text).toContain(SAMPLE_TOTAL);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the generated fixture for the live script", async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const bytes = await readFile(path.resolve(repoRoot, SAMPLE_INVOICE_RELATIVE_PATH));
    expect(bytes.byteLength).toBeGreaterThan(0);
    const text = await pageText(bytes);
    expect(text).toContain(SAMPLE_VENDOR);
    expect(text).toContain(SAMPLE_LINE_DESCRIPTION);
    expect(text).toContain(SAMPLE_TOTAL);
  });
});

async function pageText(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(1);
  return visibleText(decodeContents(pdf.getPage(0).node.Contents()));
}

function decodeContents(contents: PDFStream | PDFArray | undefined): string {
  if (contents instanceof PDFRawStream) {
    return decodeRaw(contents);
  }
  if (contents instanceof PDFArray) {
    return decodeArray(contents);
  }
  throw new Error("Sample invoice page has no content stream");
}

function decodeArray(contents: PDFArray): string {
  const parts: string[] = [];
  for (let index = 0; index < contents.size(); index += 1) {
    parts.push(decodeRaw(contents.lookup(index, PDFRawStream)));
  }
  return parts.join("");
}

function decodeRaw(stream: PDFRawStream): string {
  return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
}

function visibleText(content: string): string {
  const pieces: string[] = [];
  for (const match of content.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = match[1];
    if (hex !== undefined) {
      pieces.push(hexToLatin1(hex));
    }
  }
  return pieces.join("");
}

function hexToLatin1(hex: string): string {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return Buffer.from(bytes).toString("latin1");
}
