import { parseChatFrame, takeSseFrames, type ChatStreamEvent } from "./chat-frames";

type ChatListener = (event: ChatStreamEvent) => void;

export async function streamChatReply(
  message: string,
  threadId: string | null,
  onEvent: ChatListener,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(chatRequestBody(message, threadId)),
    signal,
  });
  if (!response.ok) {
    throw new Error(await chatFailureText(response));
  }
  if (response.body === null) {
    throw new Error("Chat response had no body");
  }
  await readChatStream(response.body, onEvent);
}

function chatRequestBody(message: string, threadId: string | null): { message: string; threadId?: string } {
  if (threadId === null || threadId.length === 0) {
    return { message };
  }
  return { message, threadId };
}

async function chatFailureText(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  const status = String(response.status);
  if (body.length === 0) {
    return `POST /api/chat failed with ${status}`;
  }
  return `POST /api/chat failed with ${status}: ${body}`;
}

async function readChatStream(body: ReadableStream<Uint8Array>, onEvent: ChatListener): Promise<void> {
  const reader = body.getReader();
  try {
    await pumpChatStream(reader, onEvent);
  } finally {
    reader.releaseLock();
  }
}

async function pumpChatStream(reader: ReadableStreamDefaultReader<Uint8Array>, onEvent: ChatListener): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      emitChatFrames(pending + decoder.decode(), true, onEvent);
      return;
    }
    pending = emitChatFrames(pending + decoder.decode(next.value, { stream: true }), false, onEvent);
  }
}

function emitChatFrames(buffer: string, flush: boolean, onEvent: ChatListener): string {
  const split = takeSseFrames(buffer, flush);
  for (const frame of split.frames) {
    const event = parseChatFrame(frame);
    if (event !== undefined) {
      onEvent(event);
    }
  }
  return split.rest;
}
