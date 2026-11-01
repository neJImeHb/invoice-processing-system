import type { Server } from "node:http";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { Pool } from "pg";
import type { ChatTurn } from "../src/agent/chat-turn.js";
import { bindInvoiceChat, createInvoiceAgent, type InvoiceAgent } from "../src/agent/graph.js";
import { createInvoiceTools } from "../src/agent/invoice-tools.js";
import { ScriptedChatModel } from "../src/agent/scripted-model.js";
import { createKafka } from "../src/kafka/client.js";
import { createKafkaPublisher, type KafkaPublisher } from "../src/kafka/producer.js";
import { createFakeEmbedder } from "../src/services/fakes.js";
import { createSseHub, type SseHub } from "../src/services/sse.js";
import { bootTestApp, type BootedTestApp } from "../src/test-server.js";
import { closeServer, composeUp, databaseUrl, kafkaBrokers, listen } from "./health-support.js";
import { toolDependencies } from "./tools-harness.js";

export interface ChatHarness {
  readonly baseUrl: string;
  readonly pool: Pool;
  shutdown(): Promise<void>;
}

interface ChatHolder {
  agent?: InvoiceAgent;
}

interface ChatResources {
  readonly booted: BootedTestApp;
  readonly server: Server;
  readonly publisher: KafkaPublisher;
  readonly sse: SseHub;
  readonly checkpointer: PostgresSaver;
  readonly baseUrl: string;
}

export async function bootChatHarness(): Promise<ChatHarness> {
  await composeUp();
  const publisher = createKafkaPublisher(createKafka(kafkaBrokers));
  const sse = createSseHub();
  const checkpointer = PostgresSaver.fromConnString(databaseUrl);
  let booted: BootedTestApp | undefined;
  let server: Server | undefined;
  try {
    await checkpointer.setup();
    const opened = await openChatApp(publisher, sse, checkpointer);
    booted = opened.booted;
    server = opened.server;
    return opened.harness;
  } catch (error) {
    await stopChat({ booted, server, publisher, sse, checkpointer });
    throw error;
  }
}

export async function checkpointRows(pool: Pool, threadId: string): Promise<number> {
  const result = await pool.query<{ count: unknown }>(
    "SELECT COUNT(*)::int AS count FROM checkpoints WHERE thread_id = $1",
    [threadId],
  );
  return countValue(result.rows[0]?.count);
}

async function openChatApp(
  publisher: KafkaPublisher,
  sse: SseHub,
  checkpointer: PostgresSaver,
): Promise<{ booted: BootedTestApp; server: Server; harness: ChatHarness }> {
  const holder: ChatHolder = {};
  const booted = await bootTestApp({
    databaseUrl,
    kafkaBrokers,
    publisher,
    chat: {
      runTurn(turn: ChatTurn): Promise<void> {
        return runBoundTurn(holder.agent, turn);
      },
    },
  });
  try {
    return await startedChat(holder, booted, publisher, sse, checkpointer);
  } catch (error) {
    await booted.shutdown();
    throw error;
  }
}

async function startedChat(
  holder: ChatHolder,
  booted: BootedTestApp,
  publisher: KafkaPublisher,
  sse: SseHub,
  checkpointer: PostgresSaver,
): Promise<{ booted: BootedTestApp; server: Server; harness: ChatHarness }> {
  holder.agent = createInvoiceAgent({
    model: new ScriptedChatModel(),
    tools: createInvoiceTools(toolDependencies(booted.pool, publisher, sse), createFakeEmbedder()),
    checkpointer,
  });
  const started = await listen(booted.app);
  const resources = { booted, server: started.server, publisher, sse, checkpointer, baseUrl: started.url };
  return { booted, server: started.server, harness: harnessFor(resources) };
}

function harnessFor(resources: ChatResources): ChatHarness {
  return {
    baseUrl: resources.baseUrl,
    pool: resources.booted.pool,
    shutdown(): Promise<void> {
      return stopChat(resources);
    },
  };
}

function runBoundTurn(agent: InvoiceAgent | undefined, turn: ChatTurn): Promise<void> {
  if (agent === undefined) {
    return Promise.reject(new Error("Invoice agent is not ready"));
  }
  return bindInvoiceChat(agent).runTurn(turn);
}

async function stopChat(resources: Partial<ChatResources>): Promise<void> {
  if (resources.server !== undefined) {
    resources.server.closeAllConnections();
    await closeServer(resources.server);
  }
  await resources.booted?.shutdown();
  await resources.publisher?.disconnect();
  resources.sse?.close();
  await resources.checkpointer?.end();
}

function countValue(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  throw new Error("checkpoint count was not an integer");
}
