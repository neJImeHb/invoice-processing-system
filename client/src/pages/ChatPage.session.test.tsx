import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, NavLink, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_SESSION_KEY, writeChatSession } from "../state/chat-store";
import { ChatPage } from "./ChatPage";
import {
  THREAD_ID,
  messageValue,
  requestJson,
  sampleSession,
  scriptedChatResponse,
  sendDraft,
  sseFrame,
  waitUntilIdle,
} from "./chat-test-support";

const PROMPTS = [
  "Скільки всього завантажено інвойсів та які їхні статуси?",
  "Яка загальна сума витрат за всіма завершеними рахунками?",
  "Знайди інвойси, де є згадка про послуги розробки або ліцензії.",
  "Повтори обробку для всіх невдалих інвойсів.",
] as const;

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", () => Promise.reject(new Error("unexpected chat fetch")));
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("ChatPage session", () => {
  it("shows the four suggestion chips on an empty transcript", () => {
    render(<ChatPage />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    for (const prompt of PROMPTS) {
      expect(screen.getByRole("button", { name: prompt })).toBeTruthy();
    }
  });

  it("sends a chip's exact string and clears the field", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(requestJson(init));
      return Promise.resolve(quietResponse());
    });
    render(<ChatPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("button", { name: PROMPTS[3] }));
    expect(messageValue()).toBe("");
    expect(screen.queryByRole("button", { name: PROMPTS[0] })).toBeNull();
    expect(screen.getByText(PROMPTS[3])).toBeTruthy();
    expect(screen.queryByText("draft")).toBeNull();
    await waitUntilIdle();
    expect(bodies).toEqual([{ message: PROMPTS[3] }]);
  });
});

describe("ChatPage persistence", () => {
  it("restores the thread and transcript after leaving the chat route", async () => {
    writeChatSession(sampleSession());
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(requestJson(init));
      return Promise.resolve(replyResponse());
    });
    render(<ChatRoutes />);
    expect(screen.getByText("Earlier question")).toBeTruthy();
    expect(screen.getByText("Earlier answer")).toBeTruthy();
    expect(screen.getByText("Saved failure")).toBeTruthy();
    expect(document.querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-22T08:00:00.000Z");
    fireEvent.click(screen.getByRole("link", { name: "Invoices" }));
    expect(screen.getByText("Invoices home")).toBeTruthy();
    expect(screen.queryByText("Earlier answer")).toBeNull();
    expect(bodies).toEqual([]);
    fireEvent.click(screen.getByRole("link", { name: "AI Assistant" }));
    expect(screen.getByText("Earlier answer")).toBeTruthy();
    expect(document.body.textContent).toContain("secret-arg");
    expect(sessionStorage.getItem(CHAT_SESSION_KEY)).toContain(THREAD_ID);
    sendDraft("Status?");
    expect(await screen.findByText("Still here")).toBeTruthy();
    await waitUntilIdle();
    expect(bodies).toEqual([{ message: "Status?", threadId: THREAD_ID }]);
  });

  it("copies the assistant text without the tool payload", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    writeChatSession(sampleSession());
    render(<ChatPage />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("Earlier answer");
  });

  it("does not open an invoice EventSource", () => {
    const Source = vi.fn();
    vi.stubGlobal("EventSource", Source);
    render(<ChatPage />);
    expect(Source).not.toHaveBeenCalled();
  });
});

function ChatRoutes() {
  return (
    <MemoryRouter initialEntries={["/chat"]}>
      <nav>
        <NavLink to="/">Invoices</NavLink>
        <NavLink to="/chat">AI Assistant</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<p>Invoices home</p>} />
        <Route path="/chat" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function quietResponse(): Response {
  return scriptedChatResponse([
    sseFrame("meta", { threadId: THREAD_ID }),
    sseFrame("done", { type: "done" }),
  ], -1).response;
}

function replyResponse(): Response {
  return scriptedChatResponse([
    sseFrame("meta", { threadId: THREAD_ID }),
    sseFrame("token", { type: "token", text: "Still here" }),
    sseFrame("done", { type: "done" }),
  ], -1).response;
}
