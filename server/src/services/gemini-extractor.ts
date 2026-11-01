import { GoogleGenAI, type Content, type GenerateContentParameters, type Part } from "@google/genai";
import { InvoiceExtractionSchema, type InvoiceExtraction } from "../domain/extraction.js";
import { invoiceExtractionPrompt } from "./extraction-prompt.js";
import { invoiceResponseJsonSchema } from "./extraction-schema.js";
import type { InvoiceExtractor } from "./extractor.js";

export interface InlineDataPart {
  readonly inlineData: {
    readonly mimeType: string;
    readonly data: string;
  };
}

export interface TextPart {
  readonly text: string;
}

export interface GenerateContentConfig {
  readonly temperature: 0;
  readonly responseMimeType: "application/json";
  readonly responseJsonSchema: Record<string, unknown>;
  readonly thinkingConfig?: {
    readonly thinkingBudget: 0;
  };
}

export interface GenerateContentRequest {
  readonly model: string;
  readonly contents: readonly {
    readonly role: "user";
    readonly parts: readonly [InlineDataPart, TextPart];
  }[];
  readonly config: GenerateContentConfig;
}

export interface GenerateContentResult {
  readonly text: string | undefined;
}

export interface GenerateContent {
  (request: GenerateContentRequest): Promise<GenerateContentResult>;
}

export interface GeminiExtractorOptions {
  readonly model: string;
  readonly generateContent: GenerateContent;
}

interface FileInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export function createGeminiExtractor(options: GeminiExtractorOptions): InvoiceExtractor {
  return {
    extract(input): Promise<InvoiceExtraction> {
      return extractWithGemini(options, input);
    },
  };
}

export function createGeminiClient(apiKey: string): GenerateContent {
  const ai = new GoogleGenAI({ apiKey });
  return (request) => requestGemini(ai, request);
}

async function extractWithGemini(
  options: GeminiExtractorOptions,
  input: FileInput,
): Promise<InvoiceExtraction> {
  const request = buildRequest(options.model, input);
  try {
    return await readExtraction(options.generateContent, request);
  } catch (error) {
    if (!isThinkingBudgetRejection(error)) {
      throw error;
    }
    console.error("Gemini rejected thinkingConfig; retrying once without it", error);
    return readExtraction(options.generateContent, withoutThinking(request));
  }
}

function buildRequest(model: string, input: FileInput): GenerateContentRequest {
  return {
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: input.mimeType,
              data: Buffer.from(input.bytes).toString("base64"),
            },
          },
          { text: invoiceExtractionPrompt },
        ],
      },
    ],
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      responseJsonSchema: invoiceResponseJsonSchema(),
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
}

function withoutThinking(request: GenerateContentRequest): GenerateContentRequest {
  return {
    model: request.model,
    contents: request.contents,
    config: {
      temperature: request.config.temperature,
      responseMimeType: request.config.responseMimeType,
      responseJsonSchema: request.config.responseJsonSchema,
    },
  };
}

async function readExtraction(
  generateContent: GenerateContent,
  request: GenerateContentRequest,
): Promise<InvoiceExtraction> {
  const response = await generateContent(request);
  return parseExtractionText(response.text);
}

function parseExtractionText(text: string | undefined): InvoiceExtraction {
  if (text === undefined || text.trim() === "") {
    throw new Error("Gemini extraction returned no text");
  }
  const parsed: unknown = JSON.parse(text);
  return InvoiceExtractionSchema.parse(parsed);
}

function isThinkingBudgetRejection(error: unknown): boolean {
  return readHttpStatus(error) === 400 && readErrorMessage(error).toLowerCase().includes("thinking");
}

function readHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error) || !("status" in error)) {
    return undefined;
  }
  const { status } = error;
  return typeof status === "number" ? status : undefined;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

async function requestGemini(ai: GoogleGenAI, request: GenerateContentRequest): Promise<GenerateContentResult> {
  const response = await ai.models.generateContent(toSdkParameters(request));
  return { text: response.text };
}

function toSdkParameters(request: GenerateContentRequest): GenerateContentParameters {
  return {
    model: request.model,
    contents: request.contents.map(toSdkContent),
    config: toSdkConfig(request.config),
  };
}

function toSdkContent(content: GenerateContentRequest["contents"][number]): Content {
  return {
    role: content.role,
    parts: content.parts.map(toSdkPart),
  };
}

function toSdkPart(part: InlineDataPart | TextPart): Part {
  if ("inlineData" in part) {
    return {
      inlineData: {
        mimeType: part.inlineData.mimeType,
        data: part.inlineData.data,
      },
    };
  }
  return { text: part.text };
}

function toSdkConfig(config: GenerateContentConfig): NonNullable<GenerateContentParameters["config"]> {
  const sdkConfig: NonNullable<GenerateContentParameters["config"]> = {
    temperature: config.temperature,
    responseMimeType: config.responseMimeType,
    responseJsonSchema: config.responseJsonSchema,
  };
  if (config.thinkingConfig !== undefined) {
    sdkConfig.thinkingConfig = { thinkingBudget: config.thinkingConfig.thinkingBudget };
  }
  return sdkConfig;
}
