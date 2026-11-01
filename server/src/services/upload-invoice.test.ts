import { mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { AppDependencies, InvoicePublisher } from "../app.js";
import { createOutboxMemoryPool, type OutboxMemory } from "./outbox-memory.fixture.js";
import type { InvoiceStatusNotice, SseHub } from "./sse.js";
import { receiveInvoiceUpload, type MemoryUpload } from "./upload-invoice.js";

const UPLOAD: MemoryUpload = {
  buffer: Buffer.from("%PDF-1.4"),
  mimetype: "application/pdf",
  originalname: "invoice.pdf",
};

function recordingHub(): { readonly sse: SseHub; readonly statuses: InvoiceStatusNotice[] } {
  const statuses: InvoiceStatusNotice[] = [];
  const sse: SseHub = {
    subscribe() {
      return undefined;
    },
    unsubscribe() {
      return undefined;
    },
    publishStatus(event: InvoiceStatusNotice): void {
      statuses.push(event);
    },
    publishDeleted() {
      return undefined;
    },
    close() {
      return undefined;
    },
  };
  return { sse, statuses };
}

function dependencies(pool: Pool, uploadsRoot: string, publisher: InvoicePublisher, sse: SseHub): AppDependencies {
  return {
    postgres: { check: () => Promise.resolve(true) },
    kafka: { check: () => Promise.resolve(true) },
    pool,
    uploadsRoot,
    publisher,
    sse,
  };
}

function trackingPublisher(memory: OutboxMemory, reject: boolean): InvoicePublisher {
  return {
    async publish(): Promise<void> {
      memory.events.push("publish");
      if (reject) throw new Error("broker down");
    },
  };
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "invoice-upload-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("receiveInvoiceUpload", () => {
  it("publishes only after the upload commit", async () => {
    await withRoot(async (root) => {
      const { pool, memory } = createOutboxMemoryPool();
      const { sse, statuses } = recordingHub();
      const result = await receiveInvoiceUpload(dependencies(pool, root, trackingPublisher(memory, false), sse), UPLOAD);
      const committed = memory.clients[0]?.map((call) => call.sql) ?? [];
      expect(result).toEqual({
        ok: true,
        body: { id: memory.invoices[0]?.id, filename: "invoice.pdf", status: "uploaded" },
      });
      expect(committed[0]).toBe("BEGIN");
      expect(committed[1]).toContain("INSERT INTO invoices");
      expect(committed[2]).toContain("INSERT INTO invoice_outbox");
      expect(committed[3]).toBe("COMMIT");
      expect(memory.events.indexOf("publish")).toBeGreaterThan(memory.events.indexOf("COMMIT"));
      expect(statuses.map((notice) => notice.status)).toEqual(["uploaded"]);
      expect(memory.outbox).toHaveLength(1);
      expect(memory.outbox[0]?.published).toBe(true);
    });
  });

  it("keeps the file and the uploaded row when publish rejects", async () => {
    await withRoot(async (root) => {
      const { pool, memory } = createOutboxMemoryPool();
      const { sse, statuses } = recordingHub();
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const result = await receiveInvoiceUpload(dependencies(pool, root, trackingPublisher(memory, true), sse), UPLOAD);
        expect(result).toEqual({
          ok: true,
          body: { id: memory.invoices[0]?.id, filename: "invoice.pdf", status: "uploaded" },
        });
        expect(await readdir(root)).toHaveLength(1);
        expect(statuses.map((notice) => notice.status)).toEqual(["uploaded"]);
        expect(memory.outbox).toHaveLength(1);
        expect(memory.outbox[0]?.published).toBe(false);
        expect(logged).toHaveBeenCalled();
      } finally {
        logged.mockRestore();
      }
    });
  });

  it("removes the saved file when the outbox insert throws", async () => {
    await withRoot(async (root) => {
      const { pool, memory } = createOutboxMemoryPool();
      memory.failOutboxInsert = true;
      const { sse } = recordingHub();
      let published = false;
      const publisher: InvoicePublisher = {
        async publish(): Promise<void> {
          published = true;
        },
      };
      await expect(receiveInvoiceUpload(dependencies(pool, root, publisher, sse), UPLOAD)).rejects.toThrow(
        "outbox insert failed",
      );
      expect(await readdir(root)).toEqual([]);
      expect(published).toBe(false);
      expect(memory.events).toContain("ROLLBACK");
      expect(memory.events).not.toContain("COMMIT");
    });
  });
});
