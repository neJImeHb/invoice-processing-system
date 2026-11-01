import type { Express } from "express";
import type { AppDependencies, DependencyProbe } from "../app.js";

interface HealthBody {
  readonly status: "ok" | "degraded";
  readonly postgres: boolean;
  readonly kafka: boolean;
}

async function readProbe(probe: DependencyProbe): Promise<boolean> {
  try {
    return await probe.check();
  } catch (_error) {
    // A down dependency is reported as degraded instead of HTTP 500.
    return false;
  }
}

export function registerHealth(app: Express, dependencies: AppDependencies): void {
  app.get("/api/health", async (_req, res) => {
    const postgres = await readProbe(dependencies.postgres);
    const kafka = await readProbe(dependencies.kafka);
    const body: HealthBody = {
      status: postgres && kafka ? "ok" : "degraded",
      postgres,
      kafka,
    };
    res.status(200).json(body);
  });
}
