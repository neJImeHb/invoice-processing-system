import { describe, expect, it } from "vitest";
import { postgresHealthLabel, redpandaHealthLabel } from "./health";

describe("health labels", () => {
  it("names postgres and redpanda for both booleans", () => {
    expect(postgresHealthLabel(true)).toBe("Postgres connected");
    expect(postgresHealthLabel(false)).toBe("Postgres unavailable");
    expect(redpandaHealthLabel(true)).toBe("Redpanda connected");
    expect(redpandaHealthLabel(false)).toBe("Redpanda unavailable");
  });
});
