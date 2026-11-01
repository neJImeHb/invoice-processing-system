export interface EnvSource {
  readonly [key: string]: string | undefined;
}

export interface AppEnv {
  readonly GEMINI_API_KEY: string;
  readonly DATABASE_URL: string;
  readonly KAFKA_BROKERS: string;
  readonly PORT: number;
  readonly GEMINI_MODEL: string;
}

const DEFAULT_PORT = 3001;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

function readValue(source: EnvSource, key: string): string | undefined {
  return source[key];
}

function requireValue(source: EnvSource, key: string): string {
  const value = readValue(source, key);
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function resolvePort(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_PORT;
  }
  const trimmed = raw.trim();
  if (!POSITIVE_INTEGER.test(trimmed)) {
    throw new Error("Invalid environment variable PORT: expected a positive integer");
  }
  const port = Number(trimmed);
  if (!Number.isSafeInteger(port)) {
    throw new Error("Invalid environment variable PORT: expected a positive integer");
  }
  return port;
}

function resolveGeminiModel(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_GEMINI_MODEL;
  }
  return raw.trim();
}

export function loadEnv(source: EnvSource): AppEnv {
  return {
    GEMINI_API_KEY: requireValue(source, "GEMINI_API_KEY"),
    DATABASE_URL: requireValue(source, "DATABASE_URL"),
    KAFKA_BROKERS: requireValue(source, "KAFKA_BROKERS"),
    PORT: resolvePort(readValue(source, "PORT")),
    GEMINI_MODEL: resolveGeminiModel(readValue(source, "GEMINI_MODEL")),
  };
}
