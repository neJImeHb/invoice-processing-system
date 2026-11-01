import { GoogleGenAI } from "@google/genai";
import { EMBEDDING_DIMENSIONS, type InvoiceEmbedder } from "./embedder.js";

const EMBEDDING_MODEL = "gemini-embedding-2";

export type EmbedContent = (text: string) => Promise<readonly number[]>;

export function createGeminiEmbedder(embedContent: EmbedContent): InvoiceEmbedder {
  return {
    embed(text: string): Promise<readonly number[]> {
      return embedOnce(embedContent, text);
    },
  };
}

export function createGeminiEmbedClient(apiKey: string): EmbedContent {
  const ai = new GoogleGenAI({ apiKey });
  return (text) => requestEmbedding(ai, text);
}

async function embedOnce(embedContent: EmbedContent, text: string): Promise<readonly number[]> {
  return requireDimensions(await embedContent(text));
}

async function requestEmbedding(ai: GoogleGenAI, text: string): Promise<readonly number[]> {
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: {
      outputDimensionality: EMBEDDING_DIMENSIONS,
    },
  });
  return requireDimensions(response.embeddings?.[0]?.values);
}

function requireDimensions(values: readonly number[] | undefined): readonly number[] {
  if (values !== undefined && values.length === EMBEDDING_DIMENSIONS) {
    return values;
  }
  const received = values === undefined ? 0 : values.length;
  throw new Error(
    `Embedding length must be ${String(EMBEDDING_DIMENSIONS)}, received ${String(received)}`,
  );
}
