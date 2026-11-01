import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const closeSpy = vi.fn();
const openedUrls: string[] = [];

class FakeEventSource {
  constructor(url: string | URL) {
    openedUrls.push(String(url));
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  close(): void {
    closeSpy();
  }
}

const invoice = {
  id: "inv-1",
  filename: "inv-1.pdf",
  original_name: "acme.pdf",
  mime_type: "application/pdf",
  file_size: 2048,
  file_path: "uploads/inv-1.pdf",
  status: "completed",
  error_message: null,
  extracted_data: {
    vendor: { name: "Northwind" },
    financials: { totalAmount: 120 },
  },
  created_at: "2026-10-21T10:00:00.000Z",
  updated_at: "2026-10-21T10:05:00.000Z",
};

beforeEach(() => {
  closeSpy.mockReset();
  openedUrls.length = 0;
  sessionStorage.clear();
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => Promise.resolve(jsonResponse(responseBody(input))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("lists invoices and keeps one EventSource open on the chat route", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(openedUrls).toEqual(["/api/events/invoices"]);
    expect(await screen.findByText("acme.pdf")).toBeTruthy();
    expect(screen.getByText("completed")).toBeTruthy();
    expect(screen.getByText("Northwind · 120")).toBeTruthy();
    expect(screen.getByText("2 KB")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Invoices" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "AI Assistant" }));

    expect(screen.getByRole("heading", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Invoices" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "AI Assistant" })).toBeTruthy();
    expect(openedUrls).toEqual(["/api/events/invoices"]);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("tells the user to upload when the list is empty", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === "/api/invoices") {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.resolve(jsonResponse({ postgres: true, kafka: true }));
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Upload an invoice to see it here.")).toBeTruthy();
  });
});

function responseBody(input: RequestInfo | URL): unknown {
  if (requestUrl(input) === "/api/invoices") {
    return [invoice];
  }
  return { status: "ok", postgres: true, kafka: true };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
