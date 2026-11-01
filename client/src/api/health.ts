import { isRecord } from "./guards";

export const HEALTH_POLL_INTERVAL_MS = 15_000;

export interface HealthReport {
  readonly postgres: boolean;
  readonly kafka: boolean;
}

export function postgresHealthLabel(connected: boolean): string {
  return connected ? "Postgres connected" : "Postgres unavailable";
}

export function redpandaHealthLabel(connected: boolean): string {
  return connected ? "Redpanda connected" : "Redpanda unavailable";
}

export function parseHealthReport(payload: unknown): HealthReport {
  if (!isRecord(payload) || typeof payload.postgres !== "boolean" || typeof payload.kafka !== "boolean") {
    throw new Error("Health response did not include postgres and kafka booleans");
  }
  return { postgres: payload.postgres, kafka: payload.kafka };
}

export async function fetchHealth(): Promise<HealthReport> {
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error(`GET /api/health failed with ${String(response.status)}`);
  }
  const payload: unknown = await response.json();
  return parseHealthReport(payload);
}
