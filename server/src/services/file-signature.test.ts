import { describe, expect, it } from "vitest";
import { resolveAcceptedFile } from "./file-signature.js";

const pdf = Buffer.from("%PDF-1.4\n");
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
const html = Buffer.from("<html></html>");

describe("resolveAcceptedFile", () => {
  it("accepts PDF, PNG, and JPEG when the declared type matches", () => {
    expect(resolveAcceptedFile("application/pdf", pdf)).toEqual({
      mimeType: "application/pdf",
      extension: ".pdf",
    });
    expect(resolveAcceptedFile("image/png", png)).toEqual({
      mimeType: "image/png",
      extension: ".png",
    });
    expect(resolveAcceptedFile("image/jpeg", jpeg)).toEqual({
      mimeType: "image/jpeg",
      extension: ".jpg",
    });
  });

  it("rejects HTML, image/jpg, and a mismatched pair", () => {
    expect(resolveAcceptedFile("application/pdf", html)).toBeUndefined();
    expect(resolveAcceptedFile("image/jpg", jpeg)).toBeUndefined();
    expect(resolveAcceptedFile("image/png", pdf)).toBeUndefined();
  });
});
