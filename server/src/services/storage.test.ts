import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openInsideUploads, PathEscapeError, saveAcceptedFile, StoredFileNotFoundError } from "./storage.js";

const roots: string[] = [];
const extras: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "invoice-storage-"));
  roots.push(root);
  return root;
}

describe("openInsideUploads", () => {
  afterEach(async () => {
    await Promise.all(extras.splice(0).map(async (file) => rm(file, { force: true })));
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })));
  });

  it("reads a file that was saved under the uploads root", async () => {
    const root = await makeRoot();
    const saved = await saveAcceptedFile(root, Buffer.from("%PDF"), ".pdf");
    const opened = await openInsideUploads(root, saved.absolutePath);
    expect(await readFile(opened, "utf8")).toBe("%PDF");
    expect(saved.storedName.endsWith(".pdf")).toBe(true);
  });

  it("rejects an absolute path and a .. path outside the root", async () => {
    const root = await makeRoot();
    const sentinel = path.join(os.tmpdir(), `sentinel-${path.basename(root)}.txt`);
    extras.push(sentinel);
    await writeFile(sentinel, "SENTINEL-OUTSIDE");
    const dotted = `${root}${path.sep}..${path.sep}${path.basename(sentinel)}`;
    await expect(openInsideUploads(root, sentinel)).rejects.toBeInstanceOf(PathEscapeError);
    await expect(openInsideUploads(root, dotted)).rejects.toBeInstanceOf(PathEscapeError);
    expect(await readFile(sentinel, "utf8")).toBe("SENTINEL-OUTSIDE");
  });

  it("reports a missing file as not found", async () => {
    const root = await makeRoot();
    const missing = path.join(root, "missing.pdf");
    await expect(openInsideUploads(root, missing)).rejects.toBeInstanceOf(StoredFileNotFoundError);
  });
});
