import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeleteDialog } from "./DeleteDialog";

describe("DeleteDialog", () => {
  it("does not call confirm on cancel, and calls confirm when confirmed", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DeleteDialog filename="acme.pdf" onCancel={onCancel} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
