import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { InvoicePublisher } from "../app.js";
import {
  insertOutbox,
  listUnpublishedOutbox,
  listUploadedMissingOutbox,
  markOutboxPublished,
  type UploadedMissingOutbox,
} from "../db/outbox.js";
import type { ProcessInvoiceEvent } from "../domain/invoice-event.js";

export const OUTBOX_RELAY_INTERVAL_MS = 1000;

interface OutboxRelay {
  drain(): Promise<void>;
  stop(): void;
}

let relayChain: Promise<void> = Promise.resolve();

export function drainOutbox(pool: Pool, publisher: InvoicePublisher): Promise<void> {
  const pass = relayChain.then(
    () => runPass(pool, publisher),
    () => runPass(pool, publisher),
  );
  relayChain = pass.then(
    () => undefined,
    () => undefined,
  );
  return pass;
}

async function runPass(pool: Pool, publisher: InvoicePublisher): Promise<void> {
  await backfillMissing(pool);
  await publishPending(pool, publisher);
}

async function backfillMissing(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertMissing(client);
    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

async function insertMissing(client: PoolClient): Promise<void> {
  const missing = await listUploadedMissingOutbox(client);
  for (const invoice of missing) {
    await insertOne(client, invoice);
  }
}

async function insertOne(client: PoolClient, invoice: UploadedMissingOutbox): Promise<void> {
  const id = randomUUID();
  const payload: ProcessInvoiceEvent = {
    eventId: id,
    type: "PROCESS_INVOICE",
    invoiceId: invoice.id,
    filePath: invoice.filePath,
    mimeType: invoice.mimeType,
    timestamp: new Date().toISOString(),
  };
  await insertOutbox(client, { id, invoiceId: invoice.id, payload });
}

async function publishPending(pool: Pool, publisher: InvoicePublisher): Promise<void> {
  const rows = await listUnpublishedOutbox(pool);
  for (const row of rows) {
    await publisher.publish(row.invoiceId, row.payload);
    await markOutboxPublished(pool, row.id);
  }
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    console.error(rollbackError);
  }
}

export function startOutboxRelay(pool: Pool, publisher: InvoicePublisher): Promise<OutboxRelay> {
  const timer = setInterval(() => {
    drainOutbox(pool, publisher).catch((error: unknown) => {
      console.error(error);
    });
  }, OUTBOX_RELAY_INTERVAL_MS);
  timer.unref();
  return drainOutbox(pool, publisher).then(
    () => relayControls(pool, publisher, timer),
    (error: unknown) => {
      console.error(error);
      return relayControls(pool, publisher, timer);
    },
  );
}

function relayControls(
  pool: Pool,
  publisher: InvoicePublisher,
  timer: ReturnType<typeof setInterval>,
): OutboxRelay {
  return {
    drain(): Promise<void> {
      return drainOutbox(pool, publisher);
    },
    stop(): void {
      clearInterval(timer);
    },
  };
}
