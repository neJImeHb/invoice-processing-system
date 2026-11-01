import { randomUUID } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import type { AppDependencies } from "../app.js";
import type { ChatTurnEvent } from "../agent/chat-turn.js";
import { parseInvoiceId } from "../db/invoices.js";

interface ChatRequest {
  readonly message: string;
  readonly threadId: string;
}

interface ChatError {
  readonly error: "empty_message" | "invalid_thread_id";
}

export function registerChat(app: Express, dependencies: AppDependencies): void {
  app.post("/api/chat", express.json(), (req, res, next) => {
    acceptChat(dependencies, req, res).catch(next);
  });
}

async function acceptChat(dependencies: AppDependencies, req: Request, res: Response): Promise<void> {
  const parsed = parseChatRequest(req.body);
  if (isChatError(parsed)) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const chat = dependencies.chat;
  if (chat === undefined) {
    res.status(503).json({ error: "agent_unavailable" });
    return;
  }
  openChatStream(res, parsed.threadId);
  await chat.runTurn({
    message: parsed.message,
    threadId: parsed.threadId,
    onEvent(event: ChatTurnEvent): void {
      writeSse(res, event.type, event);
    },
  });
  endStream(res);
}

function parseChatRequest(body: unknown): ChatRequest | ChatError {
  const record = isRecord(body) ? body : {};
  const message = readMessage(record);
  if (message === undefined) {
    return { error: "empty_message" };
  }
  const threadId = readThreadId(record);
  if (typeof threadId !== "string") {
    return threadId;
  }
  return { message, threadId };
}

function readMessage(body: Record<string, unknown>): string | undefined {
  const message = body.message;
  if (typeof message !== "string" || message.trim().length === 0) {
    return undefined;
  }
  return message;
}

function readThreadId(body: Record<string, unknown>): string | ChatError {
  if (!Object.hasOwn(body, "threadId") || body.threadId === undefined) {
    return randomUUID();
  }
  if (typeof body.threadId !== "string") {
    return { error: "invalid_thread_id" };
  }
  const parsed = parseInvoiceId(body.threadId);
  if (parsed === undefined) {
    return { error: "invalid_thread_id" };
  }
  return parsed;
}

function isChatError(value: ChatRequest | ChatError): value is ChatError {
  return "error" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openChatStream(res: Response, threadId: string): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  flushHeaders(res);
  writeSse(res, "meta", { threadId });
}

function flushHeaders(res: Response): void {
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
}

function writeSse(res: Response, event: string, data: unknown): void {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (error) {
    // A disconnected chat client must not fail the turn or loop on the error event.
    console.error(error);
  }
}

function endStream(res: Response): void {
  if (!res.writableEnded) {
    res.end();
  }
}
