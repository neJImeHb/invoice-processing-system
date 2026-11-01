export const EMBEDDING_DIMENSIONS = 768;

export interface InvoiceEmbedder {
  embed(text: string): Promise<readonly number[]>;
}
