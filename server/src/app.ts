import express, { type Express } from "express";
import type { Pool } from "pg";
import type { ChatRunner } from "./agent/chat-turn.js";
import type { ProcessInvoiceEvent } from "./domain/invoice-event.js";
import { registerChat } from "./routes/chat.js";
import { registerEvents } from "./routes/events.js";
import { registerHealth } from "./routes/health.js";
import { registerInvoices } from "./routes/invoices.js";
import type { SseHub } from "./services/sse.js";

export interface DependencyProbe {
  check(): Promise<boolean>;
}

export interface InvoicePublisher {
  publish(invoiceId: string, event: ProcessInvoiceEvent): Promise<void>;
}

export interface AppDependencies {
  postgres: DependencyProbe;
  kafka: DependencyProbe;
  pool: Pool;
  uploadsRoot: string;
  publisher: InvoicePublisher;
  sse: SseHub;
  chat?: ChatRunner;
}

export function unconfiguredPublisher(): InvoicePublisher {
  return {
    publish(): Promise<void> {
      return Promise.reject(new Error("Invoice publisher is not configured"));
    },
  };
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  registerHealth(app, dependencies);
  registerInvoices(app, dependencies);
  registerEvents(app, dependencies);
  registerChat(app, dependencies);
  return app;
}
