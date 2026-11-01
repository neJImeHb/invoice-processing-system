export interface SseFrame {
  readonly event: string;
  readonly data: unknown;
}

export interface ToolEndFrame {
  readonly name: string;
  readonly arguments: unknown;
  readonly result: unknown;
}

export function postChat(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function readSseFrames(text: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const part of text.split("\n\n")) {
    const frame = readFrame(part);
    if (frame !== undefined) {
      frames.push(frame);
    }
  }
  return frames;
}

export function toolEnd(frames: readonly SseFrame[], name: string): ToolEndFrame {
  for (const frame of frames) {
    const ended = toolEndFrame(frame, name);
    if (ended !== undefined) {
      return ended;
    }
  }
  throw new Error(`tool_end ${name} was not streamed`);
}

export function metaThreadId(frame: SseFrame | undefined): string {
  const threadId = asRecord(frame?.data)?.threadId;
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error("meta threadId was not text");
  }
  return threadId;
}

export function countField(result: unknown, key: string): number {
  const value = asRecord(result)?.[key];
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  throw new Error(`${key} was not a count`);
}

function toolEndFrame(frame: SseFrame, name: string): ToolEndFrame | undefined {
  if (frame.event !== "tool_end") {
    return undefined;
  }
  const record = asRecord(frame.data);
  if (record?.name !== name || typeof record.name !== "string") {
    return undefined;
  }
  return { name: record.name, arguments: record.arguments, result: record.result };
}

function readFrame(part: string): SseFrame | undefined {
  const event = lineValue(part, "event: ");
  const data = lineValue(part, "data: ");
  if (event === undefined || data === undefined) {
    return undefined;
  }
  return { event, data: parseData(data) };
}

function lineValue(frame: string, prefix: string): string | undefined {
  for (const line of frame.split("\n")) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length);
    }
  }
  return undefined;
}

function parseData(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
