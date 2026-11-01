import type { AppDependencies } from "../app.js";
import { commitUploadedInvoice } from "./enqueue-invoice.js";
import { displayName } from "./display-name.js";
import { resolveAcceptedFile, type AcceptedUpload } from "./file-signature.js";
import { publishInvoiceStatus } from "./invoice-status.js";
import { drainOutbox } from "./outbox-relay.js";
import { isStoredFileMissing, removeStoredFile, saveAcceptedFile, type StoredObject } from "./storage.js";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface MemoryUpload {
  readonly buffer: Buffer;
  readonly mimetype: string;
  readonly originalname: string;
}

export type UploadFailure = "empty_body" | "file_too_large" | "unsupported_media";

export interface UploadSuccess {
  readonly id: string;
  readonly filename: string;
  readonly status: "uploaded";
}

export type UploadResult =
  | { readonly ok: true; readonly body: UploadSuccess }
  | { readonly ok: false; readonly error: UploadFailure };

export function readMemoryUpload(value: unknown): MemoryUpload | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isMemoryUpload(value)) {
    throw new Error("Upload did not keep the file in memory");
  }
  return value;
}

export async function receiveInvoiceUpload(
  dependencies: AppDependencies,
  part: MemoryUpload | undefined,
): Promise<UploadResult> {
  if (part === undefined || part.buffer.length === 0) {
    return failure("empty_body");
  }
  if (part.buffer.length > MAX_UPLOAD_BYTES) {
    return failure("file_too_large");
  }
  const accepted = resolveAcceptedFile(part.mimetype, part.buffer);
  if (accepted === undefined) {
    return failure("unsupported_media");
  }
  const saved = await saveAcceptedFile(dependencies.uploadsRoot, part.buffer, accepted.extension);
  try {
    return await commitStoredUpload(dependencies, part, accepted, saved);
  } catch (error) {
    await discardFile(saved.absolutePath);
    throw error;
  }
}

async function commitStoredUpload(
  dependencies: AppDependencies,
  part: MemoryUpload,
  accepted: AcceptedUpload,
  saved: StoredObject,
): Promise<UploadResult> {
  const row = await commitUploadedInvoice(dependencies.pool, {
    filename: saved.storedName,
    originalName: displayName(part.originalname, accepted.extension),
    mimeType: accepted.mimeType,
    fileSize: part.buffer.length,
    filePath: saved.absolutePath,
  });
  try {
    await drainOutbox(dependencies.pool, dependencies.publisher);
  } catch (error) {
    console.error(error);
  }
  publishInvoiceStatus(dependencies.sse, row);
  return {
    ok: true,
    body: { id: row.id, filename: row.original_name, status: "uploaded" },
  };
}

async function discardFile(absolutePath: string): Promise<void> {
  try {
    await removeStoredFile(absolutePath);
  } catch (error) {
    if (!isStoredFileMissing(error)) {
      throw error;
    }
  }
}

function failure(error: UploadFailure): UploadResult {
  return { ok: false, error };
}

function isMemoryUpload(value: unknown): value is MemoryUpload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("buffer" in value) || !("mimetype" in value) || !("originalname" in value)) {
    return false;
  }
  return Buffer.isBuffer(value.buffer) && typeof value.mimetype === "string" && typeof value.originalname === "string";
}
