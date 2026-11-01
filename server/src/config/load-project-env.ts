import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

export function projectEnvPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env");
}

export function loadProjectEnvFile(envPath: string = projectEnvPath()): void {
  try {
    loadEnvFile(envPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot load environment file ${envPath}: ${reason}`, { cause: error });
  }
}
