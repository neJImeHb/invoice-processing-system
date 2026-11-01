import { randomUUID } from "node:crypto";
import { mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredExtension } from "./file-signature.js";

export interface StoredObject {
  readonly storedName: string;
  readonly absolutePath: string;
}

export class StoredFileNotFoundError extends Error {
  constructor() {
    super("Stored file was not found");
    this.name = "StoredFileNotFoundError";
  }
}

export class PathEscapeError extends Error {
  constructor() {
    super("Stored path is outside the uploads root");
    this.name = "PathEscapeError";
  }
}

export async function saveAcceptedFile(
  uploadsRoot: string,
  bytes: Uint8Array,
  extension: StoredExtension,
): Promise<StoredObject> {
  await mkdir(uploadsRoot, { recursive: true });
  const storedName = `${randomUUID()}${extension}`;
  const absolutePath = path.resolve(uploadsRoot, storedName);
  await writeFile(absolutePath, bytes);
  return { storedName, absolutePath };
}

export async function removeStoredFile(absolutePath: string): Promise<void> {
  await unlink(absolutePath);
}

export function isStoredFileMissing(error: unknown): boolean {
  return isErrorCode(error, "ENOENT");
}

export async function openInsideUploads(uploadsRoot: string, storedPath: string): Promise<string> {
  const rootReal = await realPathOrNotFound(uploadsRoot);
  const resolved = path.resolve(uploadsRoot, storedPath);
  const candidateReal = await realPathOrNotFound(resolved);
  if (!isInsideRoot(rootReal, candidateReal)) {
    throw new PathEscapeError();
  }
  return candidateReal;
}

async function realPathOrNotFound(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch (error) {
    if (isStoredFileMissing(error)) {
      throw new StoredFileNotFoundError();
    }
    throw error;
  }
}

function comparablePath(real: string): string {
  const stripped = real.startsWith("\\\\?\\") ? real.slice(4) : real;
  return path.resolve(stripped);
}

function isInsideRoot(rootReal: string, candidateReal: string): boolean {
  const relative = path.relative(comparablePath(rootReal), comparablePath(candidateReal));
  if (relative === "" || path.isAbsolute(relative)) {
    return false;
  }
  return !relative.split(/[/\\]/).includes("..");
}

function isErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return error.code === code;
}
