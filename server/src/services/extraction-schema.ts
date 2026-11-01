import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { InvoiceExtractionSchema } from "../domain/extraction.js";

// Gemini's responseJsonSchema subset rejects $schema and default. Zod applies defaults when the text is parsed.
const DROPPED_SCHEMA_KEYS = new Set(["$schema", "default"]);

const SCHEMA_MAP_KEYS = new Set(["$defs", "properties"]);

const GEMINI_SCHEMA_KEYS = new Set([
  "$anchor",
  "$defs",
  "$id",
  "$ref",
  "additionalProperties",
  "anyOf",
  "description",
  "enum",
  "format",
  "items",
  "maxItems",
  "maximum",
  "minItems",
  "minimum",
  "oneOf",
  "prefixItems",
  "properties",
  "propertyOrdering",
  "required",
  "title",
  "type",
]);

export function invoiceResponseJsonSchema(): Record<string, unknown> {
  return toGeminiJsonSchema(InvoiceExtractionSchema);
}

export function toGeminiJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const converted: unknown = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  });
  const rewritten = rewriteValue(converted);
  if (!isRecord(rewritten)) {
    throw new Error("Invoice JSON schema must be an object");
  }
  return rewritten;
}

function rewriteValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(rewriteValue);
  }
  if (isRecord(value)) {
    return rewriteRecord(value);
  }
  throw new Error("Invoice JSON schema contains a value Gemini cannot encode");
}

function rewriteRecord(node: Record<string, unknown>): Record<string, unknown> {
  const flattened = flattenNullUnion(node);
  if (flattened !== undefined) {
    return rewriteRecord(flattened);
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node)) {
    if (DROPPED_SCHEMA_KEYS.has(key)) {
      continue;
    }
    if (SCHEMA_MAP_KEYS.has(key)) {
      result[key] = rewriteSchemaMap(child);
      continue;
    }
    if (!GEMINI_SCHEMA_KEYS.has(key)) {
      throw new Error(`Gemini response schema does not support keyword ${key}`);
    }
    result[key] = rewriteValue(child);
  }
  return result;
}

function rewriteSchemaMap(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Invoice JSON schema map must be an object");
  }
  const result: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(value)) {
    result[name] = rewriteValue(child);
  }
  return result;
}

function flattenNullUnion(node: Record<string, unknown>): Record<string, unknown> | undefined {
  const branches = unionBranches(node);
  if (branches === undefined) {
    return undefined;
  }
  const valueBranch = singleValueBranch(branches);
  if (valueBranch === undefined) {
    return undefined;
  }
  const typeName = nonNullTypeName(valueBranch.type);
  if (typeName === undefined) {
    return undefined;
  }
  return {
    ...omitKey(valueBranch, "type"),
    ...omitUnionKeys(node),
    type: [typeName, "null"],
  };
}

function unionBranches(node: Record<string, unknown>): readonly unknown[] | undefined {
  if (Array.isArray(node.anyOf)) {
    return node.anyOf;
  }
  if (Array.isArray(node.oneOf)) {
    return node.oneOf;
  }
  return undefined;
}

function singleValueBranch(branches: readonly unknown[]): Record<string, unknown> | undefined {
  const values = branches.filter((branch) => !isNullBranch(branch));
  const nulls = branches.filter((branch) => isNullBranch(branch));
  const value = values[0];
  if (values.length !== 1 || nulls.length !== 1 || !isRecord(value)) {
    return undefined;
  }
  return value;
}

function isNullBranch(branch: unknown): boolean {
  if (!isRecord(branch)) {
    return false;
  }
  if (branch.type === "null") {
    return true;
  }
  return Array.isArray(branch.type) && branch.type.length === 1 && branch.type[0] === "null";
}

function nonNullTypeName(type: unknown): string | undefined {
  if (typeof type === "string" && type !== "null") {
    return type;
  }
  if (Array.isArray(type) && type.length === 1 && typeof type[0] === "string" && type[0] !== "null") {
    return type[0];
  }
  return undefined;
}

function omitUnionKeys(node: Record<string, unknown>): Record<string, unknown> {
  return omitKey(omitKey(node, "anyOf"), "oneOf");
}

function omitKey(node: Record<string, unknown>, key: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node)) {
    if (name !== key) {
      result[name] = value;
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
