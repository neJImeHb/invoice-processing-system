export interface ObservedEvent {
  readonly event: string;
  readonly invoiceId: string;
  readonly status: string | undefined;
  readonly errorMessage: string | null | undefined;
  readonly updatedAt: string | undefined;
}

export function findEvent(text: string, eventName: string, invoiceId: string): ObservedEvent | undefined {
  for (const frame of completeFrames(text)) {
    const observed = readFrame(frame);
    if (observed?.event === eventName && observed.invoiceId === invoiceId) {
      return observed;
    }
  }
  return undefined;
}

function completeFrames(text: string): string[] {
  const parts = text.split("\n\n");
  if (!text.endsWith("\n\n")) {
    parts.pop();
  }
  return parts.filter((part) => part.length > 0);
}

function readFrame(frame: string): ObservedEvent | undefined {
  const event = lineValue(frame, "event: ");
  const data = lineValue(frame, "data: ");
  if (event === undefined || data === undefined) {
    return undefined;
  }
  return parseEventData(event, data);
}

function lineValue(frame: string, prefix: string): string | undefined {
  for (const line of frame.split("\n")) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length);
    }
  }
  return undefined;
}

function parseEventData(event: string, raw: string): ObservedEvent | undefined {
  const parsed = parseJson(raw);
  if (parsed === undefined || typeof parsed["invoiceId"] !== "string") {
    return undefined;
  }
  const status = parsed["status"];
  const updatedAt = parsed["updatedAt"];
  return {
    event,
    invoiceId: parsed["invoiceId"],
    status: typeof status === "string" ? status : undefined,
    errorMessage: errorMessageOf(parsed["errorMessage"]),
    updatedAt: typeof updatedAt === "string" ? updatedAt : undefined,
  };
}

function parseJson(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

function errorMessageOf(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
