import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSseHub,
  formatDeletedEvent,
  formatPing,
  formatStatusEvent,
  type InvoiceStatusNotice,
  type SseClient,
  type SseHub,
} from "./sse.js";

const notice: InvoiceStatusNotice = {
  invoiceId: "inv-1",
  status: "uploaded",
  errorMessage: null,
  updatedAt: "2026-10-21T10:00:00.000Z",
};

const statusData =
  '{"invoiceId":"inv-1","status":"uploaded","errorMessage":null,"updatedAt":"2026-10-21T10:00:00.000Z"}';

function recordingClient(): SseClient & { readonly frames: string[] } {
  const frames: string[] = [];
  return {
    frames,
    write(chunk: string): boolean {
      frames.push(chunk);
      return true;
    },
    on(): undefined {
      return undefined;
    },
  };
}

function throwingClient(): SseClient {
  return {
    write(): boolean {
      throw new Error("socket hang up");
    },
    on(): undefined {
      return undefined;
    },
  };
}

describe("sse frames", () => {
  const hubs: SseHub[] = [];

  afterEach(() => {
    for (const hub of hubs.splice(0)) {
      hub.close();
    }
    vi.useRealTimers();
  });

  it("formats status frames with a null error and ids 1 then 2", () => {
    expect(formatStatusEvent(1, notice)).toBe(`event: INVOICE_STATUS_CHANGED\nid: 1\ndata: ${statusData}\n\n`);
    expect(formatStatusEvent(2, notice)).toBe(`event: INVOICE_STATUS_CHANGED\nid: 2\ndata: ${statusData}\n\n`);
    expect(formatDeletedEvent("inv-1")).toBe('event: INVOICE_DELETED\ndata: {"invoiceId":"inv-1"}\n\n');
    expect(formatPing()).toBe(": ping\n\n");
  });

  it("assigns ids 1 then 2 and skips the delete event", () => {
    const hub = createSseHub();
    hubs.push(hub);
    const client = recordingClient();
    hub.subscribe(client);
    hub.publishStatus(notice);
    hub.publishDeleted(notice.invoiceId);
    hub.publishStatus({ ...notice, invoiceId: "inv-2" });
    expect(client.frames[0]).toBe(formatStatusEvent(1, notice));
    expect(client.frames[1]).toBe(formatDeletedEvent(notice.invoiceId));
    expect(client.frames[2]).toBe(formatStatusEvent(2, { ...notice, invoiceId: "inv-2" }));
  });

  it("drops a client whose write throws and keeps the others", () => {
    const hub = createSseHub();
    hubs.push(hub);
    const live = recordingClient();
    hub.subscribe(live);
    hub.subscribe(throwingClient());
    expect(() => {
      hub.publishStatus(notice);
    }).not.toThrow();
    hub.publishStatus({ ...notice, invoiceId: "inv-2" });
    expect(live.frames).toEqual([
      formatStatusEvent(1, notice),
      formatStatusEvent(2, { ...notice, invoiceId: "inv-2" }),
    ]);
  });

  it("writes : ping every 15 seconds until close", () => {
    vi.useFakeTimers();
    const hub = createSseHub();
    hubs.push(hub);
    const client = recordingClient();
    hub.subscribe(client);
    vi.advanceTimersByTime(14_999);
    expect(client.frames).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(client.frames).toEqual([formatPing()]);
    hub.close();
    vi.advanceTimersByTime(15_000);
    expect(client.frames).toEqual([formatPing()]);
  });
});
