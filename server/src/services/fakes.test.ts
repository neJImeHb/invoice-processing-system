import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "./embedder.js";
import { createFakeEmbedder, createFakeExtractor, fakeEmbed } from "./fakes.js";

function euclideanNorm(vector: readonly number[]): number {
  let sumSquares = 0;
  for (const value of vector) {
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares);
}

describe("fakeEmbed", () => {
  it("returns a stable unit vector of length 768", () => {
    const first = fakeEmbed("Northwind invoice");
    const second = fakeEmbed("Northwind invoice");
    expect(first).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(Math.abs(euclideanNorm(first) - 1)).toBeLessThan(1e-6);
    expect(first).toEqual(second);
    expect(first.every((value) => value === 0)).toBe(false);
  });

  it("returns a different vector for a different text", () => {
    expect(fakeEmbed("alpha")).not.toEqual(fakeEmbed("beta"));
    expect(fakeEmbed("cloud hosting")).not.toEqual(fakeEmbed("cloud hosting subscription"));
  });

  it("counts embedder calls and delegates to fakeEmbed", async () => {
    const embedder = createFakeEmbedder();
    await expect(embedder.embed("same")).resolves.toEqual(fakeEmbed("same"));
    await embedder.embed("other");
    expect(embedder.calls).toBe(2);
  });
});

describe("createFakeExtractor", () => {
  it("returns the fixed Northwind extraction and counts calls", async () => {
    const extractor = createFakeExtractor();
    const extracted = await extractor.extract({ bytes: new Uint8Array([1]), mimeType: "application/pdf" });
    expect(extractor.calls).toBe(1);
    expect(extracted.invoiceNumber).toBe("INV-100");
    expect(extracted.vendor.name).toBe("Northwind");
    expect(extracted.financials.totalAmount).toBe(120);
    expect(extracted.lineItems[0]?.description).toBe("cloud hosting subscription");
    expect(extracted.normalizedText.length).toBeGreaterThan(0);
  });
});
