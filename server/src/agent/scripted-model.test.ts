import { HumanMessage, ToolMessage, type AIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { ScriptedChatModel } from "./scripted-model.js";

const STATISTICS_PROMPT = "Скільки всього завантажено інвойсів та які їхні статуси?";
const RETRY_ALL_PROMPT = "Повтори обробку для всіх невдалих інвойсів.";
const FAILED_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const LATER_FAILED_ID = "11111111-1111-4111-8111-111111111111";

describe("scripted chat model", () => {
  it("keeps the statistics prompt and a retry-plus-uuid message on one tool call", async () => {
    const model = new ScriptedChatModel();
    const statistics = await model.invoke([new HumanMessage(STATISTICS_PROMPT)]);
    expect(toolCall(statistics)).toEqual({ name: "get_invoice_statistics_and_list", args: {} });

    const counted = await model.invoke([
      new HumanMessage(STATISTICS_PROMPT),
      statisticsTool("{}"),
    ]);
    expect(toolCall(counted)).toBeUndefined();
    expect(counted.content).toBe("Готово.");

    const retry = await model.invoke([new HumanMessage(`Please retry ${FAILED_ID}`)]);
    expect(toolCall(retry)).toEqual({ name: "retry_failed_invoice", args: { id: FAILED_ID } });

    const retried = await model.invoke([
      new HumanMessage(`Please retry ${FAILED_ID}`),
      retryTool("{}"),
    ]);
    expect(toolCall(retried)).toBeUndefined();
    expect(retried.content).toBe("Готово.");
  });

  it("retries only the first failed row from the statistics result", async () => {
    const model = new ScriptedChatModel();
    const asked = await model.invoke([
      new HumanMessage(STATISTICS_PROMPT),
      statisticsTool("{\"recent\":[]}"),
      new HumanMessage(RETRY_ALL_PROMPT),
    ]);
    expect(toolCall(asked)).toEqual({ name: "get_invoice_statistics_and_list", args: {} });

    const statistics = JSON.stringify({
      recent: [
        { id: "done-1", status: "completed" },
        { id: FAILED_ID, status: "failed" },
        { id: LATER_FAILED_ID, status: "failed" },
      ],
    });
    const retry = await model.invoke([
      new HumanMessage(RETRY_ALL_PROMPT),
      statisticsTool(statistics),
    ]);
    expect(toolCall(retry)).toEqual({ name: "retry_failed_invoice", args: { id: FAILED_ID } });

    const done = await model.invoke([
      new HumanMessage(RETRY_ALL_PROMPT),
      statisticsTool(statistics),
      retry,
      retryTool("{\"httpStatus\":200}"),
    ]);
    expect(toolCall(done)).toBeUndefined();
    expect(done.content).toBe("Готово.");
  });
});

function toolCall(message: AIMessage): { name: string; args: unknown } | undefined {
  const call = message.tool_calls?.[0];
  if (call === undefined) {
    return undefined;
  }
  return { name: call.name, args: call.args };
}

function statisticsTool(content: string): ToolMessage {
  return new ToolMessage({
    content,
    name: "get_invoice_statistics_and_list",
    tool_call_id: "statistics-call",
  });
}

function retryTool(content: string): ToolMessage {
  return new ToolMessage({
    content,
    name: "retry_failed_invoice",
    tool_call_id: "retry-call",
  });
}
