import { createReadStream } from "node:fs";
import type { Express, NextFunction, Request, Response } from "express";
import type { AppDependencies } from "../app.js";
import { countInvoiceChunks, findInvoiceById, listInvoices, parseInvoiceId } from "../db/invoices.js";
import { deleteInvoiceAndFile, openInvoiceInsideUploads } from "../services/invoice-files.js";
import { parseListQuery } from "../services/list-query.js";

export function registerInvoiceReads(app: Express, dependencies: AppDependencies): void {
  app.get("/api/invoices", (req, res, next) => {
    listHandler(dependencies, req, res).catch(next);
  });
  app.get("/api/invoices/:id/file", (req, res, next) => {
    fileHandler(dependencies, req, res, next).catch(next);
  });
  app.get("/api/invoices/:id", (req, res, next) => {
    detailHandler(dependencies, req, res).catch(next);
  });
  app.delete("/api/invoices/:id", (req, res, next) => {
    deleteHandler(dependencies, req, res).catch(next);
  });
}

async function listHandler(dependencies: AppDependencies, req: Request, res: Response): Promise<void> {
  const parsed = parseListQuery(req.query);
  if (parsed === "invalid_status") {
    res.status(400).json({ error: "invalid_status" });
    return;
  }
  res.status(200).json(await listInvoices(dependencies.pool, parsed));
}

async function detailHandler(dependencies: AppDependencies, req: Request, res: Response): Promise<void> {
  const id = requestInvoiceId(req);
  if (id === undefined) {
    sendNotFound(res);
    return;
  }
  const invoice = await findInvoiceById(dependencies.pool, id);
  if (invoice === undefined) {
    sendNotFound(res);
    return;
  }
  const chunksCount = await countInvoiceChunks(dependencies.pool, id);
  res.status(200).json({ invoice, chunksCount });
}

async function fileHandler(
  dependencies: AppDependencies,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = requestInvoiceId(req);
  if (id === undefined) {
    sendNotFound(res);
    return;
  }
  const opened = await openInvoiceInsideUploads(dependencies, id);
  if (opened === undefined) {
    sendNotFound(res);
    return;
  }
  res.setHeader("Content-Type", opened.mimeType);
  const stream = createReadStream(opened.absolutePath);
  stream.on("error", (error: Error) => {
    next(error);
  });
  stream.pipe(res);
}

async function deleteHandler(dependencies: AppDependencies, req: Request, res: Response): Promise<void> {
  const id = requestInvoiceId(req);
  if (id === undefined) {
    sendNotFound(res);
    return;
  }
  const removed = await deleteInvoiceAndFile(dependencies, id);
  if (!removed) {
    sendNotFound(res);
    return;
  }
  res.status(200).json({ success: true });
}

function requestInvoiceId(req: Request): string | undefined {
  const raw = req.params.id;
  if (typeof raw !== "string") {
    return undefined;
  }
  return parseInvoiceId(raw);
}

function sendNotFound(res: Response): void {
  res.status(404).json({ error: "not_found" });
}
