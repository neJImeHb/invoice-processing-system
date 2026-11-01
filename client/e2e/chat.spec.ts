import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";
import { Pool } from "pg";
import { invoiceRow, uploadPdf } from "./retry-flow";

const DATABASE_URL = "postgres://postgres:postgrespassword@localhost:5432/invoice_db";
const RETRY_CHIP = "Повтори обробку для всіх невдалих інвойсів.";
const STATUS_TIMEOUT = 90_000;

test("retry chip reprocesses one failed invoice", async ({ page }) => {
  const filename = `e2e-chat-${randomUUID()}.pdf`;
  const pdfPath = path.join(os.tmpdir(), filename);
  await writeFile(pdfPath, pdfBytes());
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await page.goto("/");
    const invoiceId = await uploadPdf(page, pdfPath);
    const uploaded = invoiceRow(page, filename);
    await expect(uploaded.getByText("completed", { exact: true })).toBeVisible({ timeout: STATUS_TIMEOUT });
    await markFailed(pool, invoiceId);
    await openChat(page);
    await page.getByRole("button", { name: RETRY_CHIP, exact: true }).click();
    const pill = page.getByRole("article", { name: "retry_failed_invoice" });
    await expect(pill).toBeVisible({ timeout: STATUS_TIMEOUT });
    await expect(pill).toContainText("retry_failed_invoice");
    await expect(pill.getByText("Result", { exact: true })).toBeVisible();
    await expect(pill.locator("pre").last()).not.toHaveText("Running");
    await page.getByRole("link", { name: "Invoices", exact: true }).click();
    const row = invoiceRow(page, filename);
    await expect(row.getByText("failed", { exact: true })).toHaveCount(0, { timeout: STATUS_TIMEOUT });
    await expect(row.getByText("completed", { exact: true })).toBeVisible({ timeout: STATUS_TIMEOUT });
  } finally {
    await pool.end();
    await rm(pdfPath, { force: true });
  }
});

async function openChat(page: Page): Promise<void> {
  const lists = [page.waitForResponse(isInvoiceList), page.waitForResponse(isInvoiceList)];
  await page.goto("/chat");
  await Promise.all(lists);
  await expect(page.getByRole("button", { name: RETRY_CHIP, exact: true })).toBeVisible();
}

function isInvoiceList(response: Response): boolean {
  if (response.request().method() !== "GET" || !response.ok()) {
    return false;
  }
  return new URL(response.url()).pathname === "/api/invoices";
}

async function markFailed(pool: Pool, invoiceId: string): Promise<void> {
  const result = await pool.query(
    "UPDATE invoices SET status = 'failed'::invoice_status, error_message = $2 WHERE id = $1::uuid",
    [invoiceId, "injected failure"],
  );
  if (result.rowCount !== 1) {
    throw new Error("Uploaded invoice was not marked failed");
  }
}

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
}
