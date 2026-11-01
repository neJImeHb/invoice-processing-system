import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadDropzone } from "./UploadDropzone";

const OVERSIZED_BYTES = 20 * 1024 * 1024 + 1;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UploadDropzone", () => {
  it("shows an error for a file larger than 20 MB and does not construct XMLHttpRequest", () => {
    const constructed = vi.fn();
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        constructor() {
          constructed();
        }
      },
    );
    const onUploaded = vi.fn();
    render(<UploadDropzone onUploaded={onUploaded} />);

    fireEvent.change(screen.getByLabelText("Choose invoice file"), {
      target: { files: [oversizedPdf()] },
    });

    expect(screen.getByRole("alert").textContent).toMatch(/larger than 20 MB/);
    expect(constructed).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
  });
});

function oversizedPdf(): File {
  const file = new File(["invoice"], "huge.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "size", { configurable: true, value: OVERSIZED_BYTES });
  return file;
}
