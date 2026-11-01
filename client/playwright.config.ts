import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEnv = omitGemini(process.env);

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
  },
  webServer: [
    {
      command: "npm run start:test-server -w server",
      cwd: repoRoot,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:3001/api/health",
    },
    {
      command: "npm run dev -w client -- --host 127.0.0.1 --port 5173",
      cwd: repoRoot,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:5173",
    },
  ],
});

function omitGemini(env: { readonly [key: string]: string | undefined }): { [key: string]: string } {
  const next: { [key: string]: string | undefined } = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    if (key.toUpperCase() === "GEMINI_API_KEY") {
      next[key] = undefined;
      continue;
    }
    next[key] = value;
  }
  // Playwright merges process.env under this object, so deleting the key would restore it.
  // Node drops undefined entries. An empty string would still set the variable.
  next.GEMINI_API_KEY = undefined;
  return next as { [key: string]: string };
}
