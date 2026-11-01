import { findEvent, type ObservedEvent } from "./event-frame.js";

export type { ObservedEvent };

export interface EventStream {
  header(name: string): string | null;
  text(): string;
  waitFor(eventName: string, invoiceId: string, timeoutMs: number): Promise<ObservedEvent>;
  waitForText(needle: string, timeoutMs: number): Promise<void>;
  stop(): Promise<void>;
}

interface StreamState {
  text: string;
  stopped: boolean;
}

export async function openEventStream(url: string): Promise<EventStream> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const body = response.body;
  if (response.status !== 200 || body === null) {
    throw new Error(`event stream was not opened: ${String(response.status)}`);
  }
  const state: StreamState = { text: "", stopped: false };
  const waiters = new Set<() => void>();
  const reader = body.getReader();
  pump(reader, state, waiters);
  return streamApi(response, state, waiters, () => stopStream(state, controller, reader));
}

function streamApi(
  response: Response,
  state: StreamState,
  waiters: Set<() => void>,
  stop: () => Promise<void>,
): EventStream {
  return {
    header(name: string): string | null {
      return response.headers.get(name);
    },
    text(): string {
      return state.text;
    },
    waitFor(eventName: string, invoiceId: string, timeoutMs: number): Promise<ObservedEvent> {
      return waitForValue(
        waiters,
        () => findEvent(state.text, eventName, invoiceId),
        timeoutMs,
        `${eventName} ${invoiceId}`,
        () => state.text,
      );
    },
    async waitForText(needle: string, timeoutMs: number): Promise<void> {
      await waitForValue(
        waiters,
        () => (state.text.includes(needle) ? needle : undefined),
        timeoutMs,
        needle,
        () => state.text,
      );
    },
    stop,
  };
}

function pump(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: StreamState,
  waiters: Set<() => void>,
): void {
  const decoder = new TextDecoder();
  const read = (): void => {
    reader.read().then(
      (result) => {
        if (state.stopped || result.done) {
          return;
        }
        state.text += decoder.decode(result.value, { stream: true });
        notify(waiters);
        read();
      },
      (error: unknown) => {
        if (!state.stopped && !isAbortError(error)) {
          console.error(error);
        }
      },
    );
  };
  read();
}

async function stopStream(
  state: StreamState,
  controller: AbortController,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  state.stopped = true;
  controller.abort();
  try {
    await reader.cancel();
  } catch (error) {
    if (!isAbortError(error)) {
      throw error;
    }
  }
}

function waitForValue<T>(
  waiters: Set<() => void>,
  read: () => T | undefined,
  timeoutMs: number,
  label: string,
  detail: () => string,
): Promise<T> {
  const existing = read();
  if (existing !== undefined) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(wake);
      reject(new Error(`timed out waiting for ${label}. seen: ${detail()}`));
    }, timeoutMs);
    const wake = (): void => {
      const match = read();
      if (match === undefined) {
        return;
      }
      clearTimeout(timer);
      waiters.delete(wake);
      resolve(match);
    };
    waiters.add(wake);
  });
}

function notify(waiters: Set<() => void>): void {
  for (const wake of [...waiters]) {
    wake();
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
