import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectEnvFile } from "./load-project-env.js";

const probe = "INVOICE_ENV_LOAD_PROBE";
const preset = "INVOICE_ENV_PRESET_PROBE";
const here = path.dirname(fileURLToPath(import.meta.url));
const created: string[] = [];

describe("loadProjectEnvFile", () => {
  afterEach(async () => {
    delete process.env[probe];
    delete process.env[preset];
    await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("copies file values into the process and keeps variables already set", async () => {
    const envPath = await writeEnv(`${probe}=from-file\n${preset}=from-file\n`);
    process.env[preset] = "from-process";
    delete process.env[probe];

    loadProjectEnvFile(envPath);

    expect(process.env[probe]).toBe("from-file");
    expect(process.env[preset]).toBe("from-process");
  });

  it("throws when the environment file is missing", () => {
    const envPath = path.join(tmpdir(), "missing-invoice-env-file.env");
    expect(() => loadProjectEnvFile(envPath)).toThrow(`Cannot load environment file ${envPath}`);
  });

  it("loads the project file before reading process.env in both entry points", () => {
    for (const name of ["index.ts", "live-invoice.ts"]) {
      const source = readFileSync(path.resolve(here, "..", name), "utf8");
      const loaded = source.indexOf("loadProjectEnvFile()");
      const read = source.indexOf("loadEnv(process.env)");
      expect(loaded).toBeGreaterThanOrEqual(0);
      expect(loaded).toBeLessThan(read);
    }
  });
});

async function writeEnv(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "invoice-env-"));
  created.push(dir);
  const envPath = path.join(dir, ".env");
  await writeFile(envPath, contents);
  return envPath;
}
