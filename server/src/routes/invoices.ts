import type { Express, Request, Response } from "express";
import type { AppDependencies } from "../app.js";
import { parseInvoiceId } from "../db/invoices.js";
import { retryInvoice } from "../services/retry.js";
import { registerInvoiceReads } from "./invoice-read.js";
import { registerInvoiceUpload } from "./invoice-upload.js";

export function registerInvoices(app: Express, dependencies: AppDependencies): void {
  registerInvoiceUpload(app, dependencies);
  registerInvoiceReads(app, dependencies);
  app.post("/api/invoices/:id/retry", (req, res, next) => {
    sendRetry(dependencies, req, res).catch(next);
  });
}

async function sendRetry(dependencies: AppDependencies, req: Request, res: Response): Promise<void> {
  const id = requestedId(req);
  if (id === undefined) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const result = await retryInvoice(dependencies, id);
  res.status(result.httpStatus).json(result.body);
}

function requestedId(req: Request): string | undefined {
  const raw = req.params.id;
  if (typeof raw !== "string") {
    return undefined;
  }
  return parseInvoiceId(raw);
}
