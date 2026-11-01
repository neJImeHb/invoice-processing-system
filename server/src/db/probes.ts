import type { Pool } from "pg";
import type { DependencyProbe } from "../app.js";

export function postgresProbe(pool: Pool): DependencyProbe {
  return {
    async check(): Promise<boolean> {
      await pool.query("SELECT 1");
      return true;
    },
  };
}
