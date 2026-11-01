import type { AppDependencies } from "../app.js";
import { deleteInvoiceById, findInvoiceById } from "../db/invoices.js";
import {
  isStoredFileMissing,
  openInsideUploads,
  PathEscapeError,
  removeStoredFile,
  StoredFileNotFoundError,
} from "./storage.js";

export interface DownloadTarget {
  readonly mimeType: string;
  readonly absolutePath: string;
}

export async function openInvoiceInsideUploads(
  dependencies: AppDependencies,
  id: string,
): Promise<DownloadTarget | undefined> {
  const invoice = await findInvoiceById(dependencies.pool, id);
  if (invoice === undefined) {
    return undefined;
  }
  try {
    const absolutePath = await openInsideUploads(dependencies.uploadsRoot, invoice.file_path);
    return { mimeType: invoice.mime_type, absolutePath };
  } catch (error) {
    if (error instanceof StoredFileNotFoundError || error instanceof PathEscapeError) {
      return undefined;
    }
    throw error;
  }
}

export async function deleteInvoiceAndFile(dependencies: AppDependencies, id: string): Promise<boolean> {
  const invoice = await findInvoiceById(dependencies.pool, id);
  if (invoice === undefined) {
    return false;
  }
  await unlinkConfined(dependencies.uploadsRoot, invoice.file_path);
  const removed = await deleteInvoiceById(dependencies.pool, id);
  if (!removed) {
    return false;
  }
  dependencies.sse.publishDeleted(id);
  return true;
}

async function unlinkConfined(uploadsRoot: string, storedPath: string): Promise<void> {
  let absolutePath: string;
  try {
    absolutePath = await openInsideUploads(uploadsRoot, storedPath);
  } catch (error) {
    if (error instanceof StoredFileNotFoundError || error instanceof PathEscapeError) {
      return;
    }
    throw error;
  }
  try {
    await removeStoredFile(absolutePath);
  } catch (error) {
    if (isStoredFileMissing(error)) {
      return;
    }
    throw error;
  }
}
