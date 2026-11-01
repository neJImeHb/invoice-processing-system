import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "./ChatPage";
import { CHAT_SESSION_KEY } from "../state/chat-store";
import {
  THREAD_ID,
  messageValue,
  requestJson,
  requestUrl,
  scriptedChatResponse,
  sendDraft,
  sseFrame,
  waitUntilIdle,
} from "./chat-test-support";

const PROSE = 'I mentioned retry_failed_invoice in this sentence. [Tool Executed: retry_failed_invoice(id="inv_481")]';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChatPage stream", () => {
  it("paints the first token before the reader yields the second", async () => {
    const held = scriptedChatResponse(tokenChunks(), 2);
    const requests: RequestInit[] = [];
    stubChatFetch(held.response, requests);
    try {
      render(<ChatPage />);
      sendDraft("Hello");
      expect(messageValue()).toBe("");
      expect(screen.getByText("Hello")).toBeTruthy();
      expect(await screen.findByText("Alpha")).toBeTruthy();
      expect(screen.queryByText("AlphaBeta")).toBeNull();
    } finally {
      held.release();
    }
    expect(await screen.findByText("AlphaBeta")).toBeTruthy();
    await waitUntilIdle();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requestJson(requests[0])).toEqual({ message: "Hello" });
    expect(sessionStorage.getItem(CHAT_SESSION_KEY)).toContain(THREAD_ID);
    expect(sessionStorage.getItem(CHAT_SESSION_KEY)).toContain("AlphaBeta");
  });

  it("builds the tool pill from events when the prose names the tool", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(scriptedChatResponse(toolChunks(), -1).response));
    render(<ChatPage />);
    sendDraft("Retry them");
    expect(await screen.findByText(PROSE)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "retry_failed_invoice" })).toHaveLength(1);
    expect(document.body.textContent).toContain("inv-pill-1");
    expect(document.body.textContent).toContain('"status": "uploaded"');
    fireEvent.click(screen.getByRole("button", { name: "retry_failed_invoice" }));
    expect(document.body.textContent).not.toContain("inv-pill-1");
    expect(document.body.textContent).not.toContain('"status": "uploaded"');
    expect(screen.getByText(PROSE)).toBeTruthy();
    await waitUntilIdle();
  });

  it("renders an error event in the transcript", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(scriptedChatResponse(errorChunks(), -1).response));
    render(<ChatPage />);
    sendDraft("Hello");
    expect((await screen.findByRole("alert")).textContent).toContain("The agent failed.");
    await waitUntilIdle();
  });
});

function stubChatFetch(response: Response, requests: RequestInit[]): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    expect(requestUrl(input)).toBe("/api/chat");
    if (init !== undefined) {
      requests.push(init);
    }
    return Promise.resolve(response);
  });
}

function tokenChunks(): Uint8Array[] {
  return [
    sseFrame("meta", { threadId: THREAD_ID }),
    sseFrame("token", { type: "token", text: "Alpha" }),
    sseFrame("token", { type: "token", text: "Beta" }),
    sseFrame("done", { type: "done" }),
  ];
}

function toolChunks(): Uint8Array[] {
  const payload = { invoiceId: "inv-pill-1" };
  return [
    sseFrame("meta", { threadId: THREAD_ID }),
    sseFrame("tool_start", { type: "tool_start", name: "retry_failed_invoice", arguments: payload }),
    sseFrame("tool_end", {
      type: "tool_end",
      name: "retry_failed_invoice",
      arguments: payload,
      result: { status: "uploaded" },
    }),
    sseFrame("token", { type: "token", text: PROSE }),
    sseFrame("done", { type: "done" }),
  ];
}

function errorChunks(): Uint8Array[] {
  return [
    sseFrame("meta", { threadId: THREAD_ID }),
    sseFrame("error", { type: "error", message: "The agent failed." }),
    sseFrame("done", { type: "done" }),
  ];
}
