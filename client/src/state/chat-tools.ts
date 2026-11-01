import type { ChatStreamEvent } from "../api/chat-frames";
import type { ChatToolCall } from "./chat";

type ToolEnd = Extract<ChatStreamEvent, { type: "tool_end" }>;

export function settleChatTool(tools: readonly ChatToolCall[], event: ToolEnd): readonly ChatToolCall[] {
  const index = pendingChatTool(tools, event.name);
  if (index === -1) {
    return [...tools, finishedTool(event)];
  }
  return tools.map((tool, toolIndex) => (toolIndex === index ? finishExisting(tool, event) : tool));
}

export function chatEntryId(): string {
  return crypto.randomUUID();
}

export function chatTimestamp(): string {
  return new Date().toISOString();
}

function finishedTool(event: ToolEnd): ChatToolCall {
  return {
    id: chatEntryId(),
    name: event.name,
    arguments: event.arguments,
    result: event.result,
    settled: true,
  };
}

function finishExisting(tool: ChatToolCall, event: ToolEnd): ChatToolCall {
  return { ...tool, arguments: event.arguments, result: event.result, settled: true };
}

function pendingChatTool(tools: readonly ChatToolCall[], name: string): number {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index];
    if (tool !== undefined && tool.name === name && !tool.settled) {
      return index;
    }
  }
  return -1;
}
