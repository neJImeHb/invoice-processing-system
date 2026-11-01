import { describe, expect, it } from "vitest";
import { z } from "zod";
import { invoiceResponseJsonSchema, toGeminiJsonSchema } from "./extraction-schema.js";

const FORBIDDEN_KEYS = ["anyOf", "oneOf", "$schema", "default"] as const;

function assertNoForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoForbiddenKeys(item);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of FORBIDDEN_KEYS) {
    expect(record).not.toHaveProperty(key);
  }
  for (const child of Object.values(record)) {
    assertNoForbiddenKeys(child);
  }
}

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(schema: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = schema;
  for (const key of path) {
    if (!isSchemaRecord(current)) {
      throw new Error(`Missing schema path ${path.join(".")}`);
    }
    current = current[key];
  }
  return current;
}

describe("invoiceResponseJsonSchema", () => {
  it("encodes nullables as type arrays and never anyOf or oneOf", () => {
    const schema = invoiceResponseJsonSchema();
    assertNoForbiddenKeys(schema);
    expect(field(schema, ["properties", "invoiceNumber", "type"])).toEqual(["string", "null"]);
    expect(field(schema, ["properties", "vendor", "properties", "taxId", "type"])).toEqual(["string", "null"]);
    expect(field(schema, ["properties", "financials", "properties", "subtotal", "type"])).toEqual([
      "number",
      "null",
    ]);
  });

  it("rewrites a null anyOf into an integer type array", () => {
    const schema = toGeminiJsonSchema(
      z.object({
        count: z.number().int().nullable().describe("Count"),
      }),
    );
    assertNoForbiddenKeys(schema);
    expect(field(schema, ["properties", "count", "type"])).toEqual(["integer", "null"]);
    expect(field(schema, ["properties", "count", "description"])).toBe("Count");
  });
});
