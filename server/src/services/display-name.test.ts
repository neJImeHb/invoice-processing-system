import { describe, expect, it } from "vitest";
import { displayName } from "./display-name.js";

describe("displayName", () => {
  it("strips a/b\\\\c.pdf to c.pdf", () => {
    expect(displayName("a/b\\c.pdf", ".pdf")).toBe("c.pdf");
    expect(displayName("..\\..\\secret.pdf", ".pdf")).toBe("secret.pdf");
    expect(displayName("C:\\temp\\secret.pdf", ".pdf")).toBe("secret.pdf");
  });

  it("uses invoice plus the extension when the base name is empty", () => {
    expect(displayName("", ".png")).toBe("invoice.png");
    expect(displayName("/", ".jpg")).toBe("invoice.jpg");
    expect(displayName("\\\\", ".pdf")).toBe("invoice.pdf");
  });
});
