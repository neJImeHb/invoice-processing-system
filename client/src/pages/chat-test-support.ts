import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import type { ChatSnapshot } from "../state/chat";

export const THREAD_ID = "11111111-1111-4111-8111-111111111111";

export interface ScriptedChat {
  readonly response: Response;
  readonly release: () => void;
}

export function sseFrame(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function scriptedChatResponse(chunks: readonly Uint8Array[], holdAt: number): ScriptedChat {
  let index = 0;
  let releaseHold = (): void => {};
  const hold = holdAt < 0 ? Promise.resolve() : new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  const reader = {
    async read(): Promise<{ done: boolean; value?: Uint8Array }> {
      if (index === holdAt) {
        await hold;
      }
      const value = chunks[index];
      index += 1;
      if (value === undefined) {
        return { done: true };
      }
      return { done: false, value };
    },
    releaseLock(): void {},
  };
  const response = {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    text: () => Promise.resolve(""),
  };
  return { response: response as unknown as Response, release: releaseHold };
}

export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

export function requestJson(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error("Chat request body was not text");
  }
  return JSON.parse(body) as unknown;
}

export function sampleSession(): ChatSnapshot {
  return {
    threadId: THREAD_ID,
    entries: [
      userEntry(),
      assistantEntry(),
      {
        id: "error-1",
        role: "error",
        text: "Saved failure",
        createdAt: "2026-10-22T08:00:02.000Z",
      },
    ],
  };
}

export function sendDraft(text: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

export function messageValue(): string {
  const field = screen.getByRole("textbox", { name: "Message" });
  if (!(field instanceof HTMLTextAreaElement)) {
    throw new Error("Message field was not a textarea");
  }
  return field.value;
}

export async function waitUntilIdle(): Promise<void> {
  await waitFor(() => {
    const region = screen.getByRole("region", { name: "Assistant" });
    expect(region.getAttribute("aria-busy")).toBe("false");
  });
}

function userEntry(): ChatSnapshot["entries"][number] {
  return {
    id: "user-1",
    role: "user",
    text: "Earlier question",
    createdAt: "2026-10-22T08:00:00.000Z",
  };
}

function assistantEntry(): ChatSnapshot["entries"][number] {
  return {
    id: "assistant-1",
    role: "assistant",
    text: "Earlier answer",
    createdAt: "2026-10-22T08:00:01.000Z",
    tools: [
      {
        id: "tool-1",
        name: "retry_failed_invoice",
        arguments: { invoiceId: "secret-arg" },
        result: { status: "uploaded" },
        settled: true,
      },
    ],
  };
}
