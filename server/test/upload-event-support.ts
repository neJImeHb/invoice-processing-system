import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { expect } from "vitest";
import { bootTestApp, type BootedTestApp } from "../src/test-server.js";
import { pdfBytes } from "./upload-bytes.js";
import { readRecord, readString } from "./upload-assertions.js";
import { closeServer, listen } from "./health-support.js";
import { postFile } from "./upload-harness.js";

export async function uploadPdf(baseUrl: string, filename: string): Promise<string> {
  const response = await postFile(baseUrl, {
    bytes: pdfBytes(),
    mime: "application/pdf",
    filename,
  });
  expect(response.status).toBe(202);
  return readString(await readRecord(response), "id");
}

export async function storedPath(pool: Pool, id: string): Promise<string> {
  const result = await pool.query<{ file_path: string }>("SELECT file_path FROM invoices WHERE id = $1", [id]);
  const filePath = result.rows[0]?.file_path;
  if (filePath === undefined || filePath.length === 0) {
    throw new Error("stored file path was missing");
  }
  return filePath;
}

export async function countUnder(pool: Pool, uploadsRoot: string): Promise<number> {
  const result = await pool.query<{ count: unknown }>(
    "SELECT COUNT(*)::int AS count FROM invoices WHERE left(file_path, char_length($1::text)) = $1::text",
    [rootPrefix(uploadsRoot)],
  );
  return readCount(result.rows[0]?.count);
}

export interface RejectingApp {
  readonly baseUrl: string;
  readonly uploadsRoot: string;
  readonly pool: Pool;
  close(): Promise<void>;
}

export async function bootRejectingPublisher(databaseUrl: string, kafkaBrokers: string): Promise<RejectingApp> {
  const uploadsRoot = await mkdtemp(path.join(os.tmpdir(), "invoice-us004-fail-"));
  const booted = await bootTestApp({
    databaseUrl,
    kafkaBrokers,
    uploadsRoot,
    publisher: {
      publish(): Promise<void> {
        return Promise.reject(new Error("broker down"));
      },
    },
  });
  try {
    const started = await listen(booted.app);
    return {
      baseUrl: started.url,
      uploadsRoot,
      pool: booted.pool,
      close(): Promise<void> {
        return closeRejecting(started.server, booted, uploadsRoot);
      },
    };
  } catch (error) {
    await rm(uploadsRoot, { recursive: true, force: true });
    await booted.shutdown();
    throw error;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function closeRejecting(server: Server, booted: BootedTestApp, uploadsRoot: string): Promise<void> {
  try {
    server.closeAllConnections();
    await closeServer(server);
    await booted.pool.query(
      "DELETE FROM invoices WHERE left(file_path, char_length($1::text)) = $1::text",
      [rootPrefix(uploadsRoot)],
    );
  } finally {
    await rm(uploadsRoot, { recursive: true, force: true });
    await booted.shutdown();
  }
}

function rootPrefix(uploadsRoot: string): string {
  if (uploadsRoot.endsWith(path.sep)) {
    return uploadsRoot;
  }
  return `${uploadsRoot}${path.sep}`;
}

function readCount(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  throw new Error("invoice count was not an integer");
}
