import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { ChatTurn } from "./agent/chat-turn.js";
import { bindInvoiceChat, createInvoiceAgent, type InvoiceAgent } from "./agent/graph.js";
import { createInvoiceTools } from "./agent/invoice-tools.js";
import { ScriptedChatModel } from "./agent/scripted-model.js";
import type { AppDependencies, DependencyProbe, InvoicePublisher } from "./app.js";
import { createKafka } from "./kafka/client.js";
import { createKafkaPublisher, type KafkaPublisher } from "./kafka/producer.js";
import { createFakeEmbedder, createFakeExtractor, type FakeEmbedder } from "./services/fakes.js";
import { bootTestApp, type BootedTestApp } from "./test-server.js";

const PORT = 3001;
const DATABASE_URL = "postgres://postgres:postgrespassword@localhost:5432/invoice_db";
const KAFKA_BROKERS = "localhost:9092";

interface AgentHolder {
  agent?: InvoiceAgent;
}

interface TestProcess {
  readonly server: Server;
  readonly booted: BootedTestApp;
  readonly publisher: KafkaPublisher;
  readonly checkpointer: PostgresSaver;
}

async function main(): Promise<void> {
  const publisher = createKafkaPublisher(createKafka(KAFKA_BROKERS));
  const embedder = createFakeEmbedder();
  const checkpointer = PostgresSaver.fromConnString(DATABASE_URL);
  const holder: AgentHolder = {};
  await checkpointer.setup();
  const booted = await bootChatServer(publisher, embedder, holder);
  bindScriptedAgent(holder, booted, publisher, embedder, checkpointer);
  const server = await listen(booted, PORT);
  bindShutdown({ server, booted, publisher, checkpointer });
}

function bootChatServer(
  publisher: KafkaPublisher,
  embedder: FakeEmbedder,
  holder: AgentHolder,
): Promise<BootedTestApp> {
  return bootTestApp({
    databaseUrl: DATABASE_URL,
    kafkaBrokers: KAFKA_BROKERS,
    uploadsRoot: repoUploadsRoot(),
    publisher,
    extractor: createFakeExtractor(),
    embedder,
    chat: {
      runTurn(turn: ChatTurn): Promise<void> {
        return runBoundTurn(holder.agent, turn);
      },
    },
  });
}

function bindScriptedAgent(
  holder: AgentHolder,
  booted: BootedTestApp,
  publisher: InvoicePublisher,
  embedder: FakeEmbedder,
  checkpointer: PostgresSaver,
): void {
  holder.agent = createInvoiceAgent({
    model: new ScriptedChatModel(),
    tools: createInvoiceTools(toolDependencies(booted, publisher), embedder),
    checkpointer,
  });
}

function toolDependencies(booted: BootedTestApp, publisher: InvoicePublisher): AppDependencies {
  return {
    postgres: readyProbe(),
    kafka: readyProbe(),
    pool: booted.pool,
    uploadsRoot: repoUploadsRoot(),
    publisher,
    sse: booted.sse,
  };
}

function readyProbe(): DependencyProbe {
  return {
    check(): Promise<boolean> {
      return Promise.resolve(true);
    },
  };
}

function runBoundTurn(agent: InvoiceAgent | undefined, turn: ChatTurn): Promise<void> {
  if (agent === undefined) {
    return Promise.reject(new Error("Invoice agent is not ready"));
  }
  return bindInvoiceChat(agent).runTurn(turn);
}

function repoUploadsRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "uploads");
}

function listen(booted: BootedTestApp, port: number): Promise<Server> {
  const server = booted.app.listen(port);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      server.removeAllListeners("error");
      server.on("error", (error: Error) => {
        console.error(error);
        process.exit(1);
      });
      resolve(server);
    });
  });
}

function bindShutdown(started: TestProcess): void {
  let stopping = false;
  const stop = (): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    void shutdownStarted(started);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function shutdownStarted(started: TestProcess): Promise<void> {
  try {
    await closeServer(started.server);
    await started.booted.shutdown();
    await started.publisher.disconnect();
    await started.checkpointer.end();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
  process.exit(0);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeAllConnections();
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
