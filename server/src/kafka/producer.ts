import type { Kafka, Producer } from "kafkajs";
import type { InvoicePublisher } from "../app.js";
import type { ProcessInvoiceEvent } from "../domain/invoice-event.js";
import { INVOICE_JOBS_TOPIC } from "./topic.js";

export interface KafkaPublisher extends InvoicePublisher {
  disconnect(): Promise<void>;
}

interface ConnectionState {
  pending: Promise<void> | undefined;
}

export function createKafkaPublisher(kafka: Kafka): KafkaPublisher {
  const producer = kafka.producer();
  const state: ConnectionState = { pending: undefined };
  return {
    publish(invoiceId: string, event: ProcessInvoiceEvent): Promise<void> {
      return publishInvoiceJob(producer, state, invoiceId, event);
    },
    disconnect(): Promise<void> {
      return disconnectProducer(producer, state);
    },
  };
}

async function publishInvoiceJob(
  producer: Producer,
  state: ConnectionState,
  invoiceId: string,
  event: ProcessInvoiceEvent,
): Promise<void> {
  await connectProducer(producer, state);
  await producer.send({
    topic: INVOICE_JOBS_TOPIC,
    messages: [{ key: invoiceId, value: JSON.stringify(event) }],
  });
}

function connectProducer(producer: Producer, state: ConnectionState): Promise<void> {
  if (state.pending !== undefined) {
    return state.pending;
  }
  const pending = producer.connect().catch((error: unknown) => {
    if (state.pending === pending) {
      state.pending = undefined;
    }
    throw error;
  });
  state.pending = pending;
  return pending;
}

function disconnectProducer(producer: Producer, state: ConnectionState): Promise<void> {
  state.pending = undefined;
  return producer.disconnect();
}
