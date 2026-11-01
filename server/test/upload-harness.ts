import { spawn } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import type { Pool } from "pg";
import type { ProcessInvoiceEvent } from "../src/domain/invoice-event.js";
import { bootTestApp } from "../src/test-server.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const databaseUrl = "postgres://postgres:postgrespassword@localhost:5432/invoice_db";
const kafkaBrokers = "localhost:9092";

export interface PublishedCall {
  invoiceId: string;
  event: ProcessInvoiceEvent;
}

export interface UploadPart {
  readonly bytes: Buffer;
  readonly mime: string;
  readonly filename: string;
}

export interface RunningUploadTest {
  readonly baseUrl: string;
  readonly pool: Pool;
  readonly uploadsRoot: string;
  readonly published: PublishedCall[];
  readonly createdIds: string[];
  setRejectPublish(reject: boolean): void;
  cleanup(extraFiles?: readonly string[]): Promise<void>;
}

export async function startUploadTest(): Promise<RunningUploadTest> {
  await composeUp();
  const uploadsRoot = await mkdtemp(path.join(os.tmpdir(), "invoice-us003-"));
  const published: PublishedCall[] = [];
  const createdIds: string[] = [];
  let rejectPublish = false;
  const booted = await bootTestApp({
    databaseUrl,
    kafkaBrokers,
    uploadsRoot,
    publisher: {
      publish(invoiceId: string, event: ProcessInvoiceEvent): Promise<void> {
        if (rejectPublish) {
          return Promise.reject(new Error("broker down"));
        }
        published.push({ invoiceId, event });
        return Promise.resolve();
      },
    },
  });
  const started = await listen(booted.app);
  return {
    baseUrl: started.url,
    pool: booted.pool,
    uploadsRoot,
    published,
    createdIds,
    setRejectPublish(reject: boolean): void {
      rejectPublish = reject;
    },
    async cleanup(extraFiles: readonly string[] = []): Promise<void> {
      await closeServer(started.server);
      if (createdIds.length > 0) {
        await booted.pool.query("DELETE FROM invoices WHERE id = ANY($1::uuid[])", [createdIds]);
      }
      await rm(uploadsRoot, { recursive: true, force: true });
      await Promise.all(extraFiles.map(async (file) => rm(file, { force: true })));
      await booted.shutdown();
    },
  };
}

export function postFile(baseUrl: string, part: UploadPart): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([part.bytes], { type: part.mime }), part.filename);
  return fetch(`${baseUrl}/api/invoices/upload`, { method: "POST", body: form });
}

export async function countInvoices(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: number | string }>("SELECT COUNT(*)::int AS count FROM invoices");
  const count = result.rows[0]?.count;
  if (typeof count === "number") {
    return count;
  }
  if (typeof count === "string" && /^[0-9]+$/.test(count)) {
    return Number(count);
  }
  throw new Error("invoice count was not a number");
}

export async function listFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

function composeUp(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "up", "-d", "--wait"], { cwd: repoRoot, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`docker compose up -d --wait exited with code ${String(code)}`));
    });
  });
}

function listen(app: Express): Promise<{ server: Server; url: string }> {
  const server = app.listen(0, "127.0.0.1");
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected a TCP port"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${String(address.port)}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
