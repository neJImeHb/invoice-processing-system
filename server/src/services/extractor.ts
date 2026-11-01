import type { InvoiceExtraction } from "../domain/extraction.js";

export interface InvoiceExtractor {
  extract(input: { bytes: Uint8Array; mimeType: string }): Promise<InvoiceExtraction>;
}
