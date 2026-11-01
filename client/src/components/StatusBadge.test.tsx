import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("shows the status word for each state", () => {
    const { rerender } = render(<StatusBadge status="uploaded" errorMessage={null} />);
    expect(screen.getByText("uploaded")).toBeTruthy();
    expect(document.querySelector(".animate-pulse")).not.toBeNull();

    rerender(<StatusBadge status="processing" errorMessage={null} />);
    expect(screen.getByText("processing")).toBeTruthy();
    expect(document.querySelector(".animate-spin")).not.toBeNull();

    rerender(<StatusBadge status="completed" errorMessage={null} />);
    expect(screen.getByText("completed")).toBeTruthy();

    rerender(<StatusBadge status="failed" errorMessage="Could not read the file" />);
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText("Could not read the file")).toBeTruthy();
  });
});
