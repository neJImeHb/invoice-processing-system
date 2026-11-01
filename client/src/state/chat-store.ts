import { isRecord } from "../api/guards";
import {
  emptyChat,
  type AssistantChatEntry,
  type ChatEntry,
  type ChatSnapshot,
  type ChatToolCall,
  type ErrorChatEntry,
  type UserChatEntry,
} from "./chat";

export const CHAT_SESSION_KEY = "invoice-chat";

export function readChatSession(): ChatSnapshot {
  const raw = sessionStorage.getItem(CHAT_SESSION_KEY);
  if (raw === null) {
    return emptyChat();
  }
  try {
    return parseStoredChat(JSON.parse(raw) as unknown);
  } catch (error) {
    // A corrupt tab session is discarded so the assistant can still be used.
    console.error(error);
    return emptyChat();
  }
}

export function writeChatSession(snapshot: ChatSnapshot): void {
  sessionStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(snapshot));
}

function parseStoredChat(value: unknown): ChatSnapshot {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    throw new Error("Stored chat session was unreadable");
  }
  return { threadId: parseThreadId(value.threadId), entries: value.entries.map(parseStoredEntry) };
}

function parseThreadId(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Stored chat thread was unreadable");
  }
  return value;
}

function parseStoredEntry(value: unknown): ChatEntry {
  if (!isStoredEntry(value)) {
    throw new Error("Stored chat entry was unreadable");
  }
  if (value.role === "user") {
    return userEntry(value);
  }
  if (value.role === "error") {
    return errorEntry(value);
  }
  if (value.role === "assistant" && Array.isArray(value.tools)) {
    return assistantEntry(value);
  }
  throw new Error("Stored chat entry was unreadable");
}

function isStoredEntry(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 && typeof value.text === "string" && typeof value.createdAt === "string";
}

function userEntry(value: Record<string, unknown>): UserChatEntry {
  return { id: storedString(value.id), role: "user", text: storedString(value.text), createdAt: storedString(value.createdAt) };
}

function errorEntry(value: Record<string, unknown>): ErrorChatEntry {
  return { id: storedString(value.id), role: "error", text: storedString(value.text), createdAt: storedString(value.createdAt) };
}

function assistantEntry(value: Record<string, unknown>): AssistantChatEntry {
  const tools = value.tools;
  if (!Array.isArray(tools)) {
    throw new Error("Stored chat entry was unreadable");
  }
  return {
    id: storedString(value.id),
    role: "assistant",
    text: storedString(value.text),
    createdAt: storedString(value.createdAt),
    tools: tools.map(parseStoredTool),
  };
}

function parseStoredTool(value: unknown): ChatToolCall {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.settled !== "boolean") {
    throw new Error("Stored chat tool was unreadable");
  }
  if (!Object.hasOwn(value, "arguments") || !Object.hasOwn(value, "result")) {
    throw new Error("Stored chat tool was unreadable");
  }
  return {
    id: value.id,
    name: value.name,
    arguments: value.arguments,
    result: value.result,
    settled: value.settled,
  };
}

function storedString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Stored chat entry was unreadable");
  }
  return value;
}
