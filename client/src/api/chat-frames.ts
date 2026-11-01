import { isRecord } from "./guards";

export type ChatStreamEvent =
  | { readonly type: "meta"; readonly threadId: string }
  | { readonly type: "token"; readonly text: string }
  | { readonly type: "tool_start"; readonly name: string; readonly arguments: unknown }
  | { readonly type: "tool_end"; readonly name: string; readonly arguments: unknown; readonly result: unknown }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string };

export interface RawSseFrame {
  readonly event: string;
  readonly data: string;
}

export interface FrameSplit {
  readonly frames: readonly RawSseFrame[];
  readonly rest: string;
}

export function takeSseFrames(buffer: string, flush: boolean): FrameSplit {
  const frames: RawSseFrame[] = [];
  let rest = buffer.replaceAll("\r\n", "\n");
  let boundary = rest.indexOf("\n\n");
  while (boundary !== -1) {
    pushSseFrame(frames, rest.slice(0, boundary));
    rest = rest.slice(boundary + 2);
    boundary = rest.indexOf("\n\n");
  }
  if (!flush) {
    return { frames, rest };
  }
  pushSseTail(frames, rest);
  return { frames, rest: "" };
}

export function parseChatFrame(frame: RawSseFrame): ChatStreamEvent | undefined {
  const payload = parsePayload(frame.data);
  if (payload === undefined) {
    return { type: "error", message: "The assistant sent an unreadable event." };
  }
  return eventFromFrame(frame.event, payload);
}

function pushSseFrame(frames: RawSseFrame[], block: string): void {
  const frame = readRawFrame(block);
  if (frame !== undefined) {
    frames.push(frame);
  }
}

function pushSseTail(frames: RawSseFrame[], rest: string): void {
  if (rest.trim().length === 0) {
    return;
  }
  const frame = readRawFrame(rest);
  if (frame !== undefined) {
    frames.push(frame);
    return;
  }
  frames.push({
    event: "error",
    data: JSON.stringify({ type: "error", message: "The assistant stream ended early." }),
  });
}

function readRawFrame(block: string): RawSseFrame | undefined {
  let event = "";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    const name = sseField(line, "event");
    if (name !== undefined) {
      event = name;
      continue;
    }
    const datum = sseField(line, "data");
    if (datum !== undefined) {
      data.push(datum);
    }
  }
  if (event.length === 0 || data.length === 0) {
    return undefined;
  }
  return { event, data: data.join("\n") };
}

function sseField(line: string, name: string): string | undefined {
  const prefix = `${name}:`;
  if (!line.startsWith(prefix)) {
    return undefined;
  }
  return line.slice(prefix.length).trim();
}

function parsePayload(data: string): unknown | undefined {
  try {
    return JSON.parse(data) as unknown;
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

function eventFromFrame(event: string, payload: unknown): ChatStreamEvent | undefined {
  switch (event) {
    case "meta":
      return metaEvent(payload);
    case "token":
      return tokenEvent(payload);
    case "tool_start":
      return toolStartEvent(payload);
    case "tool_end":
      return toolEndEvent(payload);
    case "done":
      return { type: "done" };
    case "error":
      return errorEvent(payload);
    default:
      return undefined;
  }
}

function metaEvent(payload: unknown): ChatStreamEvent {
  if (!isRecord(payload) || typeof payload.threadId !== "string" || payload.threadId.length === 0) {
    return { type: "error", message: "The assistant thread id was unreadable." };
  }
  return { type: "meta", threadId: payload.threadId };
}

function tokenEvent(payload: unknown): ChatStreamEvent {
  if (!isRecord(payload) || typeof payload.text !== "string") {
    return { type: "error", message: "The assistant token was unreadable." };
  }
  return { type: "token", text: payload.text };
}

function toolStartEvent(payload: unknown): ChatStreamEvent {
  const name = toolName(payload);
  if (name === undefined || !isRecord(payload) || !Object.hasOwn(payload, "arguments")) {
    return { type: "error", message: "The assistant tool start was unreadable." };
  }
  return { type: "tool_start", name, arguments: payload.arguments };
}

function toolEndEvent(payload: unknown): ChatStreamEvent {
  const name = toolName(payload);
  if (name === undefined || !isToolResult(payload)) {
    return { type: "error", message: "The assistant tool result was unreadable." };
  }
  return { type: "tool_end", name, arguments: payload.arguments, result: payload.result };
}

function isToolResult(payload: unknown): payload is Record<string, unknown> {
  return isRecord(payload) && Object.hasOwn(payload, "arguments") && Object.hasOwn(payload, "result");
}

function errorEvent(payload: unknown): ChatStreamEvent {
  if (!isRecord(payload) || typeof payload.message !== "string" || payload.message.length === 0) {
    return { type: "error", message: "The assistant failed." };
  }
  return { type: "error", message: payload.message };
}

function toolName(payload: unknown): string | undefined {
  if (!isRecord(payload) || typeof payload.name !== "string" || payload.name.length === 0) {
    return undefined;
  }
  return payload.name;
}
