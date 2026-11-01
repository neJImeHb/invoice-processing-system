import { describe, expect, it } from "vitest";
import { documentTitle, prefixDocument, prefixQuery } from "./prefixes.js";

describe("document prefixes", () => {
  it("uses the trimmed vendor name, then the filename, then none", () => {
    expect(documentTitle("  Northwind  ", "invoice.pdf")).toBe("Northwind");
    expect(documentTitle("   ", "  invoice.pdf  ")).toBe("invoice.pdf");
    expect(documentTitle(" ", "  ")).toBe("none");
  });

  it("formats the document and query strings", () => {
    expect(prefixDocument("none", "chunk")).toBe("title: none | text: chunk");
    expect(prefixDocument("Northwind", "hosting")).toBe("title: Northwind | text: hosting");
    expect(prefixQuery("cloud hosting")).toBe("task: question answering | query: cloud hosting");
    expect(prefixQuery("total due")).toBe("task: question answering | query: total due");
  });
});
