import { tool } from "langchain";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { getInvoiceStatisticsAndList, type StatisticsInput } from "../db/statistics.js";
import type { InvoiceEmbedder } from "../services/embedder.js";
import { retryFailedInvoice, type RetryFailedInvoiceInput } from "./tools/retry.js";
import { searchInvoicesVector, type VectorSearchInput } from "./tools/search.js";

const statisticsSchema = z.object({
  status: z.enum(["uploaded", "processing", "completed", "failed", "all"]).optional(),
  vendor: z.string().optional(),
});

const searchSchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
});

const retrySchema = z.object({
  id: z.string().optional(),
  original_name: z.string().optional(),
});

export function createInvoiceTools(dependencies: AppDependencies, embedder: InvoiceEmbedder) {
  return [
    statisticsTool(dependencies.pool),
    searchTool(dependencies.pool, embedder),
    retryTool(dependencies),
  ];
}

function statisticsTool(pool: Pool) {
  return tool(async (input: StatisticsInput) => statisticsJson(pool, input), {
    name: "get_invoice_statistics_and_list",
    description: "Counts, recent invoices, and the money total. Pass status completed for a completed-only total.",
    schema: statisticsSchema,
  });
}

function searchTool(pool: Pool, embedder: InvoiceEmbedder) {
  return tool(async (input: VectorSearchInput) => searchJson(pool, embedder, input), {
    name: "search_invoices_vector",
    description: "Find which invoice mentions the query.",
    schema: searchSchema,
  });
}

function retryTool(dependencies: AppDependencies) {
  return tool(async (input: RetryFailedInvoiceInput) => retryJson(dependencies, input), {
    name: "retry_failed_invoice",
    description: "Retry one failed invoice by id or exact original_name. Not-found and conflict results are returned.",
    schema: retrySchema,
  });
}

async function statisticsJson(pool: Pool, input: StatisticsInput): Promise<string> {
  return JSON.stringify(await getInvoiceStatisticsAndList(pool, input));
}

async function searchJson(pool: Pool, embedder: InvoiceEmbedder, input: VectorSearchInput): Promise<string> {
  return JSON.stringify(await searchInvoicesVector(pool, embedder, input));
}

async function retryJson(dependencies: AppDependencies, input: RetryFailedInvoiceInput): Promise<string> {
  return JSON.stringify(await retryFailedInvoice(dependencies, input));
}
