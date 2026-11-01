import type { Express, Request, Response } from "express";
import type { AppDependencies } from "../app.js";

export function registerEvents(app: Express, dependencies: AppDependencies): void {
  app.get("/api/events/invoices", (req, res) => {
    openInvoiceStream(dependencies, req, res);
  });
}

function openInvoiceStream(dependencies: AppDependencies, req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  flushIfPresent(res);
  dependencies.sse.subscribe(res);
  req.on("close", () => {
    dependencies.sse.unsubscribe(res);
  });
}

function flushIfPresent(res: Response): void {
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
}
