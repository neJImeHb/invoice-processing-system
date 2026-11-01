import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "./embedder.js";
import { createGeminiEmbedder, type EmbedContent } from "./gemini-embedder.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function markedVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index + 1) / 10);
}

function recording(vector: readonly number[]): { readonly inputs: unknown[]; readonly embedContent: EmbedContent } {
  const inputs: unknown[] = [];
  return {
    inputs,
    embedContent(text) {
      inputs.push(text);
      return Promise.resolve(vector);
    },
  };
}

describe("createGeminiEmbedder", () => {
  it("calls the client once per embed with one string", async () => {
    const client = recording(markedVector());
    const embedder = createGeminiEmbedder(client.embedContent);
    await embedder.embed("alpha");
    await embedder.embed("beta");
    expect(client.inputs).toEqual(["alpha", "beta"]);
    expect(client.inputs.every((input) => typeof input === "string")).toBe(true);
  });

  it("throws when the mocked vector length is not 768", async () => {
    const client = recording([1, 2, 3]);
    await expect(createGeminiEmbedder(client.embedContent).embed("chunk")).rejects.toThrow(/768/);
    expect(client.inputs).toEqual(["chunk"]);
  });

  it("returns a valid 768-d vector without changing its numbers", async () => {
    const vector = markedVector();
    const client = recording(vector);
    const result = await createGeminiEmbedder(client.embedContent).embed("chunk");
    expect(result).toBe(vector);
    expect(result).toEqual(vector);
  });

  it("requests gemini-embedding-2 at 768 dimensions for one string", () => {
    const source = readFileSync(path.join(here, "gemini-embedder.ts"), "utf8");
    expect(source).toContain('"gemini-embedding-2"');
    expect(source).toContain("outputDimensionality: EMBEDDING_DIMENSIONS");
    expect(source).toContain("contents: text");
    expect(source).not.toContain("taskType");
    expect(source).not.toContain("task_type");
    expect(source).not.toContain("text-embedding-004");
    expect(source).not.toMatch(/contents:\s*\[/);
  });
});

describe("live invoice script", () => {
  it("names the sample pdf and is not part of verify", () => {
    const repo = path.resolve(here, "..", "..", "..");
    const live = readFileSync(path.resolve(here, "..", "live-invoice.ts"), "utf8");
    expect(live).toContain("server/fixtures/sample-invoice.pdf");
    expect(live).toContain("loadEnv(process.env)");
    expect(live).toContain("chunkText(");
    expect(live).toContain("prefixDocument(");
    expect(live).toContain("createGeminiEmbedder(");
    expect(live).toContain("createGeminiEmbedClient(");
    expect(live).not.toContain("unconfiguredEmbedder");
    expect(script(path.join(repo, "package.json"), "verify")).not.toContain("live:invoice");
    expect(script(path.join(repo, "package.json"), "test:unit")).not.toContain("live:invoice");
    expect(script(path.join(repo, "server", "package.json"), "test:unit")).not.toContain("live-invoice");
    expect(script(path.join(repo, "server", "package.json"), "test:integration")).not.toContain("live-invoice");
    expect(script(path.join(repo, "server", "package.json"), "test:integration:pipeline")).not.toContain("live-invoice");
    expect(script(path.join(repo, "client", "package.json"), "test:unit")).not.toContain("live-invoice");
    expect(script(path.join(repo, "client", "package.json"), "test:e2e:upload")).not.toContain("live-invoice");
    expect(script(path.join(repo, "client", "package.json"), "test:e2e:retry")).not.toContain("live-invoice");
  });
});

function script(packagePath: string, name: string): string {
  const command = readScripts(packagePath)[name];
  if (command === undefined) {
    throw new Error(`Missing script ${name} in ${packagePath}`);
  }
  return command;
}

function readScripts(packagePath: string): Readonly<Record<string, string>> {
  const parsed: unknown = JSON.parse(readFileSync(packagePath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("scripts" in parsed)) {
    throw new Error(`Missing scripts in ${packagePath}`);
  }
  const { scripts } = parsed;
  if (typeof scripts !== "object" || scripts === null) {
    throw new Error(`Missing scripts in ${packagePath}`);
  }
  const commands: Record<string, string> = {};
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== "string") {
      throw new Error(`Script ${name} in ${packagePath} is not a string`);
    }
    commands[name] = command;
  }
  return commands;
}
