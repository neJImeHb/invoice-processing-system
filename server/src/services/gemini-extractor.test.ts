import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { invoiceExtractionPrompt } from "./extraction-prompt.js";
import { invoiceResponseJsonSchema } from "./extraction-schema.js";
import {
  createGeminiExtractor,
  type GenerateContent,
  type GenerateContentRequest,
} from "./gemini-extractor.js";

const bytes = Uint8Array.from([1, 2, 3, 255]);
const mimeType = "application/pdf";
const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

const modelJson = {
  invoiceNumber: "INV-9",
  vendor: { name: "Northwind", taxId: null, address: null },
  customer: { name: null, taxId: null },
  dates: { issueDate: null, dueDate: null },
  financials: { subtotal: null, taxAmount: null, totalAmount: 42 },
  lineItems: [{ description: "paper", unitPrice: null, totalPrice: 3 }],
  normalizedText: "Northwind total 42.",
};

function sourceOf(name: string): string {
  return readFileSync(path.join(srcDir, name), "utf8");
}

function recorded(
  handle: (request: GenerateContentRequest, call: number) => Promise<{ readonly text: string | undefined }>,
): { readonly generateContent: GenerateContent; readonly requests: GenerateContentRequest[] } {
  const requests: GenerateContentRequest[] = [];
  return {
    requests,
    generateContent(request) {
      requests.push(request);
      return handle(request, requests.length);
    },
  };
}

function extractorWith(generateContent: GenerateContent) {
  return createGeminiExtractor({ model: "assigned-model", generateContent });
}

describe("createGeminiExtractor", () => {
  it("sends inline bytes with temperature 0, the schema, and thinkingBudget 0, then parses the text", async () => {
    const client = recorded(async () => ({ text: JSON.stringify(modelJson) }));
    const extracted = await extractorWith(client.generateContent).extract({ bytes, mimeType });
    const request = client.requests[0];
    expect(request?.model).toBe("assigned-model");
    expect(request?.config.temperature).toBe(0);
    expect(request?.config.responseMimeType).toBe("application/json");
    expect(request?.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(request?.config.responseJsonSchema).toEqual(invoiceResponseJsonSchema());
    expect(request?.contents[0]?.parts[0]).toEqual({
      inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") },
    });
    expect(request?.contents[0]?.parts[1]).toEqual({ text: invoiceExtractionPrompt });
    expect(extracted.invoiceNumber).toBe("INV-9");
    expect(extracted.financials.totalAmount).toBe(42);
    expect(extracted.financials.currency).toBe("USD");
    expect(extracted.financials.subtotal).toBeNull();
    expect(extracted.lineItems[0]?.quantity).toBe(1);
    expect(extracted.vendor.taxId).toBeNull();
  });

  it("retries a thinking HTTP 400 once and drops thinkingConfig", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const client = recorded(async (_request, call) => {
        if (call === 1) {
          throw new HttpStatusError(400, "Thinking budget is not supported");
        }
        return { text: JSON.stringify(modelJson) };
      });
      await extractorWith(client.generateContent).extract({ bytes, mimeType });
      expect(client.requests).toHaveLength(2);
      expect(client.requests[0]?.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
      expect(client.requests[1]?.config).not.toHaveProperty("thinkingConfig");
      expect(client.requests[1]?.contents).toEqual(client.requests[0]?.contents);
      expect(client.requests[1]?.config.responseJsonSchema).toBe(client.requests[0]?.config.responseJsonSchema);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not retry a second thinking rejection", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const client = recorded(async () => {
        throw new HttpStatusError(400, "Thinking budget is not supported");
      });
      await expect(extractorWith(client.generateContent).extract({ bytes, mimeType })).rejects.toThrow(
        /Thinking budget/,
      );
      expect(client.requests).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not retry an HTTP 500", async () => {
    const client = recorded(async () => {
      throw new HttpStatusError(500, "Thinking exploded");
    });
    await expect(extractorWith(client.generateContent).extract({ bytes, mimeType })).rejects.toThrow(/exploded/);
    expect(client.requests).toHaveLength(1);
  });

  it("does not retry an HTTP 400 that does not mention thinking", async () => {
    const client = recorded(async () => {
      throw new HttpStatusError(400, "Invalid JSON schema");
    });
    await expect(extractorWith(client.generateContent).extract({ bytes, mimeType })).rejects.toThrow(
      /Invalid JSON schema/,
    );
    expect(client.requests).toHaveLength(1);
  });

  it("rejects text that does not match the extraction schema", async () => {
    const client = recorded(async () => ({ text: JSON.stringify({ raw: true }) }));
    await expect(extractorWith(client.generateContent).extract({ bytes, mimeType })).rejects.toBeInstanceOf(
      ZodError,
    );
  });

  it("rejects invalid JSON instead of returning the raw text", async () => {
    const client = recorded(async () => ({ text: "not json" }));
    await expect(extractorWith(client.generateContent).extract({ bytes, mimeType })).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });
});

describe("Gemini wiring", () => {
  it("keeps the test servers off the Gemini extractor", () => {
    for (const name of ["test-server.ts", "dev-test-server.ts"]) {
      const source = sourceOf(name);
      expect(source).not.toContain("GeminiExtractor");
      expect(source).not.toContain("gemini-extractor");
      expect(source).not.toContain("gemini-embedder");
      expect(source).not.toContain("@google/genai");
    }
  });

  it("takes the model id from the env object and lists no fallback models", () => {
    const extractorSource = sourceOf(path.join("services", "gemini-extractor.ts"));
    const indexSource = sourceOf("index.ts");
    expect(extractorSource).not.toContain("gemini-3.5-flash-lite");
    expect(extractorSource).not.toContain("gemini-3.8-flash");
    expect(extractorSource).not.toContain("thinkingLevel");
    expect(extractorSource).not.toContain("fileData");
    expect(indexSource).toContain("createGeminiClient(env.GEMINI_API_KEY)");
    expect(indexSource).toContain("model: env.GEMINI_MODEL");
    expect(indexSource).toContain("createGeminiEmbedder(createGeminiEmbedClient(env.GEMINI_API_KEY))");
    expect(indexSource).not.toContain("unconfiguredEmbedder");
    expect(indexSource).toContain("startInvoiceConsumer");
    expect(indexSource).not.toContain("createFakeExtractor");
    expect(indexSource).not.toContain("@google/genai");
    expect(indexSource).not.toContain("gemini-2.5-flash");
    expect(indexSource).not.toContain("gemini-3.5-flash-lite");
    expect(indexSource).not.toContain("gemini-3.8-flash");
  });
});
