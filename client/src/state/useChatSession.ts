import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import type { ChatStreamEvent } from "../api/chat-frames";
import { streamChatReply } from "../api/chat";
import { appendErrorEntry, appendUserMessage, reduceChatEvent, type ChatCursor, type ChatEntry, type ChatSnapshot } from "./chat";
import { readChatSession, writeChatSession } from "./chat-store";

interface ChatHost {
  readonly abortRef: { current: AbortController | null };
  readonly busyRef: { current: boolean };
  readonly cursorRef: { current: ChatCursor };
  readonly snapshotRef: { current: ChatSnapshot };
  readonly setSnapshot: Dispatch<SetStateAction<ChatSnapshot>>;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
}

export interface ChatController {
  readonly busy: boolean;
  readonly draft: string;
  readonly entries: readonly ChatEntry[];
  readonly send: (message: string) => void;
  readonly setDraft: Dispatch<SetStateAction<string>>;
}

export function useChatSession(): ChatController {
  const [snapshot, setSnapshot] = useState(readChatSession);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const host = useChatHost(snapshot, setSnapshot, setBusy);
  const send = (message: string): void => {
    submitChat(host, setDraft, message);
  };
  return { busy, draft, entries: snapshot.entries, send, setDraft };
}

function useChatHost(
  snapshot: ChatSnapshot,
  setSnapshot: Dispatch<SetStateAction<ChatSnapshot>>,
  setBusy: Dispatch<SetStateAction<boolean>>,
): ChatHost {
  const snapshotRef = useRef(snapshot);
  const cursorRef = useRef<ChatCursor>({ assistantId: null });
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  useEffect(() => {
    const current = abortRef;
    return () => {
      current.current?.abort();
    };
  }, []);
  return { abortRef, busyRef, cursorRef, setBusy, setSnapshot, snapshotRef };
}

function submitChat(host: ChatHost, setDraft: Dispatch<SetStateAction<string>>, message: string): void {
  const text = message.trim();
  if (text.length === 0 || host.busyRef.current) {
    return;
  }
  const threadId = beginChatTurn(host, setDraft, text);
  const controller = new AbortController();
  host.abortRef.current?.abort();
  host.abortRef.current = controller;
  void runChatTurn(host, text, threadId, controller.signal);
}

function beginChatTurn(host: ChatHost, setDraft: Dispatch<SetStateAction<string>>, text: string): string | null {
  const withUser = appendUserMessage(host.snapshotRef.current, text);
  host.snapshotRef.current = withUser;
  host.cursorRef.current = { assistantId: null };
  host.busyRef.current = true;
  flushSync(() => {
    host.setSnapshot(withUser);
    host.setBusy(true);
    setDraft("");
  });
  persistChat(withUser);
  return withUser.threadId;
}

async function runChatTurn(host: ChatHost, message: string, threadId: string | null, signal: AbortSignal): Promise<void> {
  try {
    await streamChatReply(message, threadId, (event) => {
      applyStreamEvent(host, event);
    }, signal);
  } catch (error: unknown) {
    recordTurnError(host, error);
  } finally {
    host.busyRef.current = false;
    host.setBusy(false);
  }
}

function applyStreamEvent(host: ChatHost, event: ChatStreamEvent): void {
  const reduced = reduceChatEvent(host.snapshotRef.current, host.cursorRef.current, event);
  host.snapshotRef.current = reduced.snapshot;
  host.cursorRef.current = reduced.cursor;
  // Paint each event before the next body read so tokens are not buffered until done.
  flushSync(() => {
    host.setSnapshot(reduced.snapshot);
  });
  persistChat(reduced.snapshot);
}

function recordTurnError(host: ChatHost, error: unknown): void {
  if (isAbortError(error)) {
    return;
  }
  console.error(error);
  const message = error instanceof Error ? error.message : "The assistant request failed.";
  const next = appendErrorEntry(host.snapshotRef.current, message);
  host.snapshotRef.current = next;
  flushSync(() => {
    host.setSnapshot(next);
  });
  persistChat(next);
}

function persistChat(snapshot: ChatSnapshot): void {
  try {
    writeChatSession(snapshot);
  } catch (error) {
    // The transcript stays on screen when the tab cannot store it.
    console.error(error);
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
