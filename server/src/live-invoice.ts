import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, type AppEnv } from "./config/env.js";
import { loadProjectEnvFile } from "./config/load-project-env.js";
import type { InvoiceExtraction } from "./domain/extraction.js";
import { chunkText } from "./services/chunker.js";
import { resolveAcceptedFile, type StoredMimeType } from "./services/file-signature.js";
import { createGeminiEmbedClient, createGeminiEmbedder } from "./services/gemini-embedder.js";
import { createGeminiClient, createGeminiExtractor } from "./services/gemini-extractor.js";
import { documentTitle, prefixDocument } from "./services/prefixes.js";

const SAMPLE_INVOICE_PATH = "server/fixtures/sample-invoice.pdf";

interface LiveInvoiceResult {
  readonly extraction: InvoiceExtraction;
  readonly chunkCount: number;
}

function printHelp(): void {
  console.error("Usage: npm run live:invoice -- <path>");
  console.error(`Example: npm run live:invoice -- ${SAMPLE_INVOICE_PATH}`);
}

function invoiceArg(args: readonly string[]): string | undefined {
  const filePath = args[0];
  if (filePath === undefined || args.length !== 1 || filePath.trim() === "") {
    return undefined;
  }
  return filePath.trim();
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

async function main(): Promise<void> {
  const invoicePath = invoiceArg(process.argv.slice(2));
  if (invoicePath === undefined) {
    printHelp();
    process.exit(1);
  }
  loadProjectEnvFile();
  const env = loadEnv(process.env);
  const started = Date.now();
  const result = await runInvoice(env, path.resolve(repoRoot(), invoicePath));
  console.log(JSON.stringify(result.extraction, null, 2));
  console.log(`chunks: ${String(result.chunkCount)}`);
  console.log(`elapsed_ms: ${String(Date.now() - started)}`);
  process.exit(0);
}

async function runInvoice(env: AppEnv, filePath: string): Promise<LiveInvoiceResult> {
  const bytes = await readFile(filePath);
  const extraction = await extractFile(env, bytes, mimeTypeFor(filePath, bytes));
  const chunks = chunkText(extraction.normalizedText);
  if (chunks.length === 0) {
    throw new Error("Invoice normalized text produced no chunks");
  }
  await embedDocument(env, extraction, path.basename(filePath), chunks);
  return { extraction, chunkCount: chunks.length };
}

async function extractFile(env: AppEnv, bytes: Uint8Array, mimeType: string): Promise<InvoiceExtraction> {
  const extractor = createGeminiExtractor({
    model: env.GEMINI_MODEL,
    generateContent: createGeminiClient(env.GEMINI_API_KEY),
  });
  return extractor.extract({ bytes, mimeType });
}

async function embedDocument(
  env: AppEnv,
  extraction: InvoiceExtraction,
  originalName: string,
  chunks: readonly string[],
): Promise<void> {
  const embedder = createGeminiEmbedder(createGeminiEmbedClient(env.GEMINI_API_KEY));
  const title = documentTitle(extraction.vendor.name, originalName);
  for (const chunk of chunks) {
    await embedder.embed(prefixDocument(title, chunk));
  }
}

function mimeTypeFor(filePath: string, bytes: Uint8Array): string {
  const accepted = resolveAcceptedFile(declaredMime(filePath), bytes);
  if (accepted === undefined) {
    throw new Error(`Unsupported invoice file: ${filePath}`);
  }
  return accepted.mimeType;
}

function declaredMime(filePath: string): StoredMimeType {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") {
    return "application/pdf";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  throw new Error(`Unsupported invoice file: ${filePath}`);
}

function isDirectRun(): boolean {
  const self = path.resolve(fileURLToPath(import.meta.url));
  return process.argv.some((arg) => sameFile(arg, self));
}

function sameFile(entry: string, self: string): boolean {
  if (entry.startsWith("-")) {
    return false;
  }
  const invoked = path.resolve(entry);
  if (process.platform === "win32") {
    return invoked.toLowerCase() === self.toLowerCase();
  }
  return invoked === self;
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
