import { describe, expect, it } from "vitest";
import { chunkText } from "./chunker.js";

describe("chunkText", () => {
  it("returns one chunk equal to the input when the text is at most 2000 characters", () => {
    const exact = `${"a".repeat(1999)}\n`;
    expect(exact).toHaveLength(2000);
    expect(chunkText("short invoice")).toEqual(["short invoice"]);
    expect(chunkText(exact)).toEqual([exact]);
  });

  it("breaks a nearby newline and overlaps the next chunk by 200 characters", () => {
    const newlineAt = 1900;
    const text = `${"a".repeat(newlineAt)}\n${"b".repeat(400)}`;
    const chunks = chunkText(text);
    const first = `${"a".repeat(newlineAt)}\n`;
    expect(chunks[0]).toBe(first);
    expect(chunks[1]).toBe(text.slice(first.length - 200));
    expect(chunks).toHaveLength(2);
  });

  it("never emits an empty chunk", () => {
    expect(chunkText("")).toEqual([]);
    const chunks = chunkText(`${"a".repeat(1900)}\n${"b".repeat(400)}`);
    expect(chunks.some((chunk) => chunk === "")).toBe(false);
    expect(chunkText("c".repeat(4500)).some((chunk) => chunk === "")).toBe(false);
  });

  it("advances through text that has no newline", () => {
    const text = "q".repeat(4200);
    expect(chunkText(text)).toEqual([text.slice(0, 2000), text.slice(1800, 3800), text.slice(3600)]);
  });
});
