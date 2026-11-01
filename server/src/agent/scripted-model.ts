import { randomUUID } from "node:crypto";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";

const STATISTICS_PROMPT = "Скільки всього завантажено інвойсів та які їхні статуси?";
const RETRY_ALL_PROMPT = "Повтори обробку для всіх невдалих інвойсів.";
const STATISTICS_TOOL = "get_invoice_statistics_and_list";
const RETRY_TOOL = "retry_failed_invoice";
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export class ScriptedChatModel extends BaseChatModel {
  constructor() {
    super({ disableStreaming: true });
  }

  bindTools(_tools: BindToolsInput[], _kwargs?: Partial<this["ParsedCallOptions"]>): this {
    return this;
  }

  _llmType(): string {
    return "scripted-invoice";
  }

  _generate(messages: BaseMessage[], _options: this["ParsedCallOptions"]): Promise<ChatResult> {
    return Promise.resolve(scriptedResult(messages));
  }
}

function scriptedResult(messages: readonly BaseMessage[]): ChatResult {
  const message = scriptedMessage(messages);
  return { generations: [{ text: textContent(message.content), message }] };
}

function scriptedMessage(messages: readonly BaseMessage[]): AIMessage {
  const text = lastHumanText(messages);
  if (text === RETRY_ALL_PROMPT) {
    return retryAllMessage(messages);
  }
  if (hasToolResult(messages)) {
    return finalMessage();
  }
  if (text === STATISTICS_PROMPT) {
    return toolMessage(STATISTICS_TOOL, {});
  }
  const id = retryTarget(text);
  if (id !== undefined) {
    return toolMessage(RETRY_TOOL, { id });
  }
  return finalMessage();
}

function retryAllMessage(messages: readonly BaseMessage[]): AIMessage {
  const turn = messagesAfterLastHuman(messages);
  const statistics = toolResultText(turn, STATISTICS_TOOL);
  if (statistics === undefined) {
    return toolMessage(STATISTICS_TOOL, {});
  }
  if (toolResultText(turn, RETRY_TOOL) !== undefined) {
    return finalMessage();
  }
  const id = firstFailedId(statistics);
  if (id === undefined) {
    return finalMessage();
  }
  return toolMessage(RETRY_TOOL, { id });
}

function messagesAfterLastHuman(messages: readonly BaseMessage[]): readonly BaseMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.getType() === "human") {
      return messages.slice(index + 1);
    }
  }
  return [];
}

function toolResultText(messages: readonly BaseMessage[], toolName: string): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.getType() === "tool" && message.name === toolName) {
      return textContent(message.content);
    }
  }
  return undefined;
}

function firstFailedId(statistics: string): string | undefined {
  for (const row of recentRows(parseStatistics(statistics))) {
    if (isFailedRow(row)) {
      return row.id;
    }
  }
  return undefined;
}

function parseStatistics(statistics: string): unknown {
  try {
    return JSON.parse(statistics) as unknown;
  } catch (error) {
    throw new Error("Statistics tool result was not JSON", { cause: error });
  }
}

function recentRows(value: unknown): readonly unknown[] {
  const parsed = typeof value === "string" ? parseStatistics(value) : value;
  if (!isRecord(parsed) || !Array.isArray(parsed.recent)) {
    throw new Error("Statistics tool result did not include recent");
  }
  return parsed.recent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFailedRow(value: unknown): value is { readonly id: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const status = "status" in value ? value.status : undefined;
  const id = "id" in value ? value.id : undefined;
  return status === "failed" && typeof id === "string" && id.length > 0;
}

function hasToolResult(messages: readonly BaseMessage[]): boolean {
  return messages.some((message) => message.getType() === "tool");
}

function lastHumanText(messages: readonly BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.getType() === "human") {
      return textContent(message.content);
    }
  }
  return "";
}

function retryTarget(text: string): string | undefined {
  if (!text.toLowerCase().includes("retry")) {
    return undefined;
  }
  return UUID_IN_TEXT.exec(text)?.[0];
}

function toolMessage(name: string, args: Record<string, unknown>): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ id: randomUUID(), name, args, type: "tool_call" }],
  });
}

function finalMessage(): AIMessage {
  return new AIMessage("Готово.");
}

function textContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map(textPart).join("");
}

function textPart(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }
  if (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string") {
    return part.text;
  }
  return "";
}
