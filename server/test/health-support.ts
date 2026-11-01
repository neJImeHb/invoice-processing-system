import { spawn } from "node:child_process";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import type { DependencyProbe } from "../src/app.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const databaseUrl = "postgres://postgres:postgrespassword@localhost:5432/invoice_db";
export const kafkaBrokers = "localhost:9092";

export function composeUp(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "up", "-d", "--wait"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
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

export function closeServer(server: Server): Promise<void> {
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

export function listen(app: Express): Promise<{ server: Server; url: string }> {
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

export function probe(result: boolean | "throw"): DependencyProbe {
  return {
    check(): Promise<boolean> {
      if (result === "throw") {
        return Promise.reject(new Error("dependency down"));
      }
      return Promise.resolve(result);
    },
  };
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} was not returned`);
  }
  return value;
}

export function requireTimestamp(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  throw new Error("updated_at was not a timestamp");
}
