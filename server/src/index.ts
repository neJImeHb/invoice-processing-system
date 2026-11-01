import path from "node:path";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { Kafka } from "kafkajs";
import type { Pool } from "pg";
import { createApp, type AppDependencies, type InvoicePublisher } from "./app.js";
import { bindInvoiceChat, createInvoiceAgent } from "./agent/graph.js";
import { createGeminiChatModel } from "./agent/gemini-chat.js";
import { createInvoiceTools } from "./agent/invoice-tools.js";
import { loadEnv, type AppEnv } from "./config/env.js";
import { loadProjectEnvFile } from "./config/load-project-env.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { postgresProbe } from "./db/probes.js";
import { createKafka } from "./kafka/client.js";
import { startInvoiceConsumer } from "./kafka/consumer.js";
import { kafkaProbe } from "./kafka/probes.js";
import { createKafkaPublisher } from "./kafka/producer.js";
import { ensureInvoiceTopic } from "./kafka/topic.js";
import type { InvoiceEmbedder } from "./services/embedder.js";
import { createGeminiEmbedClient, createGeminiEmbedder } from "./services/gemini-embedder.js";
import { createGeminiClient, createGeminiExtractor } from "./services/gemini-extractor.js";
import { startOutboxRelay } from "./services/outbox-relay.js";
import { createSseHub, type SseHub } from "./services/sse.js";

interface LiveParts {
  readonly env: AppEnv;
  readonly pool: Pool;
  readonly kafka: Kafka;
  readonly sse: SseHub;
  readonly uploadsRoot: string;
  readonly embedder: InvoiceEmbedder;
  readonly checkpointer: PostgresSaver;
  readonly publisher: InvoicePublisher;
}

function liveDependencies(parts: LiveParts): AppDependencies {
  const dependencies = {
    postgres: postgresProbe(parts.pool),
    kafka: kafkaProbe(parts.kafka),
    pool: parts.pool,
    uploadsRoot: parts.uploadsRoot,
    publisher: parts.publisher,
    sse: parts.sse,
  };
  return {
    ...dependencies,
    chat: bindInvoiceChat(createInvoiceAgent({
      model: createGeminiChatModel(parts.env),
      tools: createInvoiceTools(dependencies, parts.embedder),
      checkpointer: parts.checkpointer,
    })),
  };
}

async function startServer(): Promise<void> {
  loadProjectEnvFile();
  const env = loadEnv(process.env);
  const pool = createPool(env.DATABASE_URL);
  await migrate(pool);
  const kafka = createKafka(env.KAFKA_BROKERS);
  await ensureInvoiceTopic(kafka);
  const publisher = createKafkaPublisher(kafka);
  const sse = createSseHub();
  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const embedder = createGeminiEmbedder(createGeminiEmbedClient(env.GEMINI_API_KEY));
  await startInvoiceConsumer({
    kafka,
    pool,
    sse,
    extractor: createGeminiExtractor({
      model: env.GEMINI_MODEL,
      generateContent: createGeminiClient(env.GEMINI_API_KEY),
    }),
    embedder,
    uploadsRoot,
  });
  const checkpointer = PostgresSaver.fromConnString(env.DATABASE_URL);
  await checkpointer.setup();
  await startOutboxRelay(pool, publisher);
  const app = createApp(liveDependencies({
    env,
    pool,
    kafka,
    sse,
    uploadsRoot,
    embedder,
    checkpointer,
    publisher,
  }));
  app.listen(env.PORT).on("error", (error: Error) => {
    console.error(error);
    process.exit(1);
  });
}

startServer().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
