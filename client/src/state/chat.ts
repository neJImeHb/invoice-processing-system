import type { ChatStreamEvent } from "../api/chat-frames";
import { chatEntryId, chatTimestamp, settleChatTool } from "./chat-tools";

export interface ChatToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly result: unknown;
  readonly settled: boolean;
}

export interface UserChatEntry {
  readonly id: string;
  readonly role: "user";
  readonly text: string;
  readonly createdAt: string;
}

export interface AssistantChatEntry {
  readonly id: string;
  readonly role: "assistant";
  readonly text: string;
  readonly createdAt: string;
  readonly tools: readonly ChatToolCall[];
}

export interface ErrorChatEntry {
  readonly id: string;
  readonly role: "error";
  readonly text: string;
  readonly createdAt: string;
}

export type ChatEntry = UserChatEntry | AssistantChatEntry | ErrorChatEntry;

export interface ChatSnapshot {
  readonly threadId: string | null;
  readonly entries: readonly ChatEntry[];
}

export interface ChatCursor {
  readonly assistantId: string | null;
}

export interface ChatReduction {
  readonly snapshot: ChatSnapshot;
  readonly cursor: ChatCursor;
}

export function emptyChat(): ChatSnapshot {
  return { threadId: null, entries: [] };
}

export function appendUserMessage(snapshot: ChatSnapshot, text: string): ChatSnapshot {
  const entry: UserChatEntry = {
    id: chatEntryId(),
    role: "user",
    text,
    createdAt: chatTimestamp(),
  };
  return { threadId: snapshot.threadId, entries: [...snapshot.entries, entry] };
}

export function appendErrorEntry(snapshot: ChatSnapshot, text: string): ChatSnapshot {
  const entry: ErrorChatEntry = {
    id: chatEntryId(),
    role: "error",
    text,
    createdAt: chatTimestamp(),
  };
  return { threadId: snapshot.threadId, entries: [...snapshot.entries, entry] };
}

export function reduceChatEvent(snapshot: ChatSnapshot, cursor: ChatCursor, event: ChatStreamEvent): ChatReduction {
  switch (event.type) {
    case "meta":
      return { snapshot: { ...snapshot, threadId: event.threadId }, cursor };
    case "token":
      return appendToken(snapshot, cursor, event.text);
    case "tool_start":
      return appendToolStart(snapshot, cursor, event);
    case "tool_end":
      return appendToolEnd(snapshot, cursor, event);
    case "error":
      return { snapshot: appendErrorEntry(snapshot, event.message), cursor };
    case "done":
      return { snapshot, cursor: { assistantId: null } };
  }
}

function appendToken(snapshot: ChatSnapshot, cursor: ChatCursor, text: string): ChatReduction {
  const opened = openAssistantEntry(snapshot, cursor);
  return {
    snapshot: mapAssistantEntry(opened.snapshot, opened.cursor.assistantId, (entry) => ({
      ...entry,
      text: entry.text + text,
    })),
    cursor: opened.cursor,
  };
}

function appendToolStart(
  snapshot: ChatSnapshot,
  cursor: ChatCursor,
  event: Extract<ChatStreamEvent, { type: "tool_start" }>,
): ChatReduction {
  const opened = openAssistantEntry(snapshot, cursor);
  const tool: ChatToolCall = {
    id: chatEntryId(),
    name: event.name,
    arguments: event.arguments,
    result: null,
    settled: false,
  };
  return {
    snapshot: mapAssistantEntry(opened.snapshot, opened.cursor.assistantId, (entry) => ({
      ...entry,
      tools: [...entry.tools, tool],
    })),
    cursor: opened.cursor,
  };
}

function appendToolEnd(
  snapshot: ChatSnapshot,
  cursor: ChatCursor,
  event: Extract<ChatStreamEvent, { type: "tool_end" }>,
): ChatReduction {
  const opened = openAssistantEntry(snapshot, cursor);
  return {
    snapshot: mapAssistantEntry(opened.snapshot, opened.cursor.assistantId, (entry) => ({
      ...entry,
      tools: settleChatTool(entry.tools, event),
    })),
    cursor: opened.cursor,
  };
}

function openAssistantEntry(snapshot: ChatSnapshot, cursor: ChatCursor): ChatReduction {
  if (cursor.assistantId !== null) {
    return { snapshot, cursor };
  }
  const entry: AssistantChatEntry = {
    id: chatEntryId(),
    role: "assistant",
    text: "",
    createdAt: chatTimestamp(),
    tools: [],
  };
  return {
    snapshot: { threadId: snapshot.threadId, entries: [...snapshot.entries, entry] },
    cursor: { assistantId: entry.id },
  };
}

function mapAssistantEntry(
  snapshot: ChatSnapshot,
  assistantId: string | null,
  update: (entry: AssistantChatEntry) => AssistantChatEntry,
): ChatSnapshot {
  if (assistantId === null) {
    return snapshot;
  }
  return {
    threadId: snapshot.threadId,
    entries: snapshot.entries.map((entry) => {
      if (entry.role !== "assistant" || entry.id !== assistantId) {
        return entry;
      }
      return update(entry);
    }),
  };
}

