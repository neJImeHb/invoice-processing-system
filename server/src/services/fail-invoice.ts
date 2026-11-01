import type { Pool, PoolClient } from "pg";
import { deleteInvoiceChunks } from "../db/chunks.js";
import type { InvoiceRecord } from "../db/invoices.js";
import { transitionInvoice } from "./transitions.js";

export async function failInvoice(
  pool: Pool,
  invoiceId: string,
  errorMessage: string,
): Promise<InvoiceRecord | undefined> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      return await commitFailure(client, invoiceId, errorMessage);
    } catch (error) {
      await rollback(client);
      throw error;
    }
  } finally {
    client.release();
  }
}

async function commitFailure(
  client: PoolClient,
  invoiceId: string,
  errorMessage: string,
): Promise<InvoiceRecord | undefined> {
  await deleteInvoiceChunks(client, invoiceId);
  const row = await transitionInvoice(client, invoiceId, "processing", "failed", { errorMessage });
  if (row === undefined) {
    await client.query("ROLLBACK");
    return undefined;
  }
  await client.query("COMMIT");
  return row;
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    console.error(rollbackError);
  }
}
