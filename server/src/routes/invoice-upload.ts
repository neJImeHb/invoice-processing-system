import { createRequire } from "node:module";
import type { Express, Request, RequestHandler, Response } from "express";
import type { AppDependencies } from "../app.js";
import { MAX_UPLOAD_BYTES, readMemoryUpload, receiveInvoiceUpload, type UploadFailure } from "../services/upload-invoice.js";

const FAILURE_STATUS: Record<UploadFailure, number> = {
  empty_body: 400,
  file_too_large: 413,
  unsupported_media: 415,
};

const require = createRequire(import.meta.url);
const multer = loadMulter();
const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES + 1 },
  preservePath: true,
}).single("file");

export function registerInvoiceUpload(app: Express, dependencies: AppDependencies): void {
  app.post("/api/invoices/upload", (req, res, next) => {
    parser(req, res, (error?: unknown) => {
      if (error !== undefined && error !== null) {
        rejectParserError(error, res);
        return;
      }
      acceptUpload(dependencies, req, res).catch(next);
    });
  });
}

async function acceptUpload(dependencies: AppDependencies, req: Request, res: Response): Promise<void> {
  const result = await receiveInvoiceUpload(dependencies, readMemoryUpload(Reflect.get(req, "file")));
  if (!result.ok) {
    res.status(FAILURE_STATUS[result.error]).json({ error: result.error });
    return;
  }
  res.status(202).json(result.body);
}

function rejectParserError(error: unknown, res: Response): void {
  if (multerCode(error) === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "file_too_large" });
    return;
  }
  res.status(400).json({ error: "empty_body" });
}

interface MulterOptions {
  readonly storage?: unknown;
  readonly limits?: {
    readonly fileSize?: number;
  };
  readonly preservePath?: boolean;
}

interface MulterFactory {
  (options?: MulterOptions): { single(fieldName: string): RequestHandler };
  memoryStorage(): unknown;
}

function loadMulter(): MulterFactory {
  const loaded: unknown = require("multer");
  if (!isMulterFactory(loaded)) {
    throw new Error("multer did not load");
  }
  return loaded;
}

function isMulterFactory(value: unknown): value is MulterFactory {
  return typeof value === "function" && "memoryStorage" in value && typeof value.memoryStorage === "function";
}

function multerCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error) || error.name !== "MulterError") {
    return undefined;
  }
  if (!("code" in error) || typeof error.code !== "string") {
    return undefined;
  }
  return error.code;
}
