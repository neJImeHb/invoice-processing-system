import { GraphRecursionError } from "@langchain/langgraph";
import type { ChatTurnEvent } from "./chat-turn.js";
import type { InvoiceAgent } from "./graph.js";

const RECURSION_LIMIT = 12;

export interface InvoiceTurn {
  readonly agent: InvoiceAgent;
  readonly message: string;
  readonly threadId: string;
  onEvent(event: ChatTurnEvent): void;
}

export async function streamInvoiceTurn(input: InvoiceTurn): Promise<void> {
  let finished = false;
  const emit = (event: ChatTurnEvent): void => {
    if (finished) {
      return;
    }
    if (event.type === "done" || event.type === "error") {
      finished = true;
    }
    input.onEvent(event);
  };
  try {
    await readAgentStream(input, emit);
    emit({ type: "done" });
  } catch (error) {
    emit({ type: "error", message: errorText(error) });
  }
}

async function readAgentStream(input: InvoiceTurn, emit: (event: ChatTurnEvent) => void): Promise<void> {
  const run = await input.agent.streamEvents(
    { messages: [{ role: "user", content: input.message }] },
    {
      version: "v3",
      recursionLimit: RECURSION_LIMIT,
      configurable: { thread_id: input.threadId },
    },
  );
  await Promise.all([
    emitMessageTokens(run.messages, emit),
    emitToolCalls(run.toolCalls, emit),
    run.output,
  ]);
}

async function emitMessageTokens(
  messages: AsyncIterable<{ readonly text: AsyncIterable<string> }>,
  emit: (event: ChatTurnEvent) => void,
): Promise<void> {
  for await (const message of messages) {
    await emitText(message.text, emit);
  }
}

async function emitText(text: AsyncIterable<string>, emit: (event: ChatTurnEvent) => void): Promise<void> {
  for await (const chunk of text) {
    if (chunk.length > 0) {
      emit({ type: "token", text: chunk });
    }
  }
}

interface ToolCallView {
  readonly name: string;
  readonly input: unknown;
  readonly output: Promise<unknown>;
}

async function emitToolCalls(
  toolCalls: AsyncIterable<ToolCallView>,
  emit: (event: ChatTurnEvent) => void,
): Promise<void> {
  for await (const call of toolCalls) {
    const argumentsValue = present(call.input);
    emit({ type: "tool_start", name: call.name, arguments: argumentsValue });
    const output = await call.output;
    emit({
      type: "tool_end",
      name: call.name,
      arguments: argumentsValue,
      result: present(toolResult(output)),
    });
  }
}

function toolResult(output: unknown): unknown {
  return decodeJson(unwrapContent(output));
}

function unwrapContent(output: unknown): unknown {
  if (typeof output !== "object" || output === null || !("content" in output)) {
    return output;
  }
  return output.content;
}

function decodeJson(value: unknown): unknown {
  const once = parseIfJson(value);
  if (typeof once !== "string") {
    return once;
  }
  return parseIfJson(once);
}

function parseIfJson(value: unknown): unknown {
  const text = jsonText(value);
  if (text === undefined) {
    return value;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    console.error(error);
    return value;
  }
}

function jsonText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const first = value[0];
  if (typeof first === "object" && first !== null && "text" in first && typeof first.text === "string") {
    return first.text;
  }
  return undefined;
}

function present(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  return value;
}

function errorText(error: unknown): string {
  if (error instanceof GraphRecursionError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Chat failed";
}
