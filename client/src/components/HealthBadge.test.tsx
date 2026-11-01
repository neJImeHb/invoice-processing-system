import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HEALTH_POLL_INTERVAL_MS } from "../api/health";
import { HealthBadge } from "./HealthBadge";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HealthBadge", () => {
  it("fetches on mount and again after 15 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ postgres: true, kafka: false }))
      .mockResolvedValueOnce(jsonResponse({ postgres: false, kafka: true }));
    vi.stubGlobal("fetch", fetchMock);

    render(<HealthBadge />);

    expect(await screen.findByText("Postgres connected")).toBeTruthy();
    expect(screen.getByText("Redpanda unavailable")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/health");
    expect(HEALTH_POLL_INTERVAL_MS).toBe(15_000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS);
    });

    expect(await screen.findByText("Postgres unavailable")).toBeTruthy();
    expect(screen.getByText("Redpanda connected")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
