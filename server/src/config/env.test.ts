import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const databaseUrl = "postgres://postgres:postgrespassword@localhost:5432/invoice_db";
const kafkaBrokers = "localhost:9092";

describe("loadEnv", () => {
  it("throws when the source is empty and names GEMINI_API_KEY", () => {
    expect(() => loadEnv({})).toThrow(/GEMINI_API_KEY/);
  });

  it("names DATABASE_URL when that required key is omitted", () => {
    expect(() =>
      loadEnv({
        GEMINI_API_KEY: "test-gemini-key",
        KAFKA_BROKERS: kafkaBrokers,
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it("throws when GEMINI_API_KEY is a blank string", () => {
    expect(() =>
      loadEnv({
        GEMINI_API_KEY: "",
        DATABASE_URL: databaseUrl,
        KAFKA_BROKERS: kafkaBrokers,
      }),
    ).toThrow(/GEMINI_API_KEY/);
  });

  it("throws when GEMINI_API_KEY is whitespace only", () => {
    expect(() =>
      loadEnv({
        GEMINI_API_KEY: " \t ",
        DATABASE_URL: databaseUrl,
        KAFKA_BROKERS: kafkaBrokers,
      }),
    ).toThrow(/GEMINI_API_KEY/);
  });

  it("defaults PORT and GEMINI_MODEL when they are omitted", () => {
    const env = loadEnv({
      GEMINI_API_KEY: "test-gemini-key",
      DATABASE_URL: databaseUrl,
      KAFKA_BROKERS: kafkaBrokers,
    });

    expect(env.GEMINI_API_KEY).toBe("test-gemini-key");
    expect(env.DATABASE_URL).toBe(databaseUrl);
    expect(env.KAFKA_BROKERS).toBe(kafkaBrokers);
    expect(env.PORT).toBe(3001);
    expect(env.GEMINI_MODEL).toBe("gemini-2.5-flash");
  });

  it("uses a provided PORT and GEMINI_MODEL", () => {
    const env = loadEnv({
      GEMINI_API_KEY: "test-gemini-key",
      DATABASE_URL: databaseUrl,
      KAFKA_BROKERS: kafkaBrokers,
      PORT: "4010",
      GEMINI_MODEL: "gemini-2.5-pro",
    });

    expect(env.PORT).toBe(4010);
    expect(env.GEMINI_MODEL).toBe("gemini-2.5-pro");
  });

  it("throws when PORT is present and not a positive integer", () => {
    const source = {
      GEMINI_API_KEY: "test-gemini-key",
      DATABASE_URL: databaseUrl,
      KAFKA_BROKERS: kafkaBrokers,
    };
    expect(() => loadEnv({ ...source, PORT: "0" })).toThrow(/PORT/);
    expect(() => loadEnv({ ...source, PORT: "" })).toThrow(/PORT/);
    expect(() => loadEnv({ ...source, PORT: "   " })).toThrow(/PORT/);
    expect(() => loadEnv({ ...source, PORT: "12px" })).toThrow(/PORT/);
  });
});
