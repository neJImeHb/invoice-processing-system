import type { InvoiceStatus } from "../db/invoices.js";

const HEARTBEAT_MS = 15_000;

export interface InvoiceStatusNotice {
  readonly invoiceId: string;
  readonly status: InvoiceStatus;
  readonly errorMessage: string | null;
  readonly updatedAt: string;
}

export interface SseClient {
  write(chunk: string): boolean;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface SseHub {
  subscribe(res: SseClient): void;
  unsubscribe(res: SseClient): void;
  publishStatus(event: InvoiceStatusNotice): void;
  publishDeleted(invoiceId: string): void;
  close(): void;
}

export function formatStatusEvent(id: number, event: InvoiceStatusNotice): string {
  const data = JSON.stringify({
    invoiceId: event.invoiceId,
    status: event.status,
    errorMessage: event.errorMessage,
    updatedAt: event.updatedAt,
  });
  return `event: INVOICE_STATUS_CHANGED\nid: ${String(id)}\ndata: ${data}\n\n`;
}

export function formatDeletedEvent(invoiceId: string): string {
  const data = JSON.stringify({ invoiceId });
  return `event: INVOICE_DELETED\ndata: ${data}\n\n`;
}

export function formatPing(): string {
  return ": ping\n\n";
}

export function createSseHub(): SseHub {
  const clients = new Set<SseClient>();
  let nextId = 0;
  const timer = setInterval(() => {
    broadcast(clients, formatPing());
  }, HEARTBEAT_MS);
  timer.unref();
  return {
    subscribe(res: SseClient): void {
      watchClient(clients, res);
    },
    unsubscribe(res: SseClient): void {
      clients.delete(res);
    },
    publishStatus(event: InvoiceStatusNotice): void {
      nextId += 1;
      broadcast(clients, formatStatusEvent(nextId, event));
    },
    publishDeleted(invoiceId: string): void {
      broadcast(clients, formatDeletedEvent(invoiceId));
    },
    close(): void {
      clearInterval(timer);
      clients.clear();
    },
  };
}

function watchClient(clients: Set<SseClient>, client: SseClient): void {
  clients.add(client);
  client.on("error", () => {
    // An asynchronous socket failure stays on this client and does not fail the upload.
    clients.delete(client);
  });
}

function broadcast(clients: Set<SseClient>, frame: string): void {
  for (const client of [...clients]) {
    writeFrame(clients, client, frame);
  }
}

function writeFrame(clients: Set<SseClient>, client: SseClient, frame: string): void {
  try {
    client.write(frame);
  } catch (error) {
    // A dead socket is removed here so the failure cannot reject the upload.
    clients.delete(client);
    console.error(error);
  }
}
