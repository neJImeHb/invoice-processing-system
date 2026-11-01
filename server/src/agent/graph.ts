import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { createAgent } from "langchain";
import type { ChatRunner, ChatTurn } from "./chat-turn.js";
import { INVOICE_AGENT_PROMPT } from "./prompt.js";
import { streamInvoiceTurn } from "./stream-turn.js";

export interface CreateInvoiceAgentInput {
  readonly model: BaseChatModel;
  readonly tools: readonly StructuredToolInterface[];
  readonly checkpointer: BaseCheckpointSaver;
}

export function createInvoiceAgent(input: CreateInvoiceAgentInput) {
  return createAgent({
    model: input.model,
    tools: [...input.tools],
    systemPrompt: INVOICE_AGENT_PROMPT,
    checkpointer: input.checkpointer,
  });
}

export type InvoiceAgent = ReturnType<typeof createInvoiceAgent>;

export function bindInvoiceChat(agent: InvoiceAgent): ChatRunner {
  return {
    runTurn(turn: ChatTurn): Promise<void> {
      return streamInvoiceTurn({
        agent,
        message: turn.message,
        threadId: turn.threadId,
        onEvent: turn.onEvent,
      });
    },
  };
}
