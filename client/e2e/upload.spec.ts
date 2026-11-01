import { Buffer } from "node:buffer";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const NORMALIZED_TEXT =
  "Invoice INV-100 from Northwind for a cloud hosting subscription. Total amount 120 USD.";

test("uploaded invoice reaches completed, shows fake extraction, then deletes", async ({ page }) => {
  const filename = `e2e-${Date.now()}.pdf`;
  const pdfPath = path.join(os.tmpdir(), filename);
  await writeFile(pdfPath, pdfBytes());
  try {
    await page.goto("/");
    const fileInput = page.locator("input[type=file]");
    await expect(fileInput).toBeVisible();
    await fileInput.setInputFiles(pdfPath);

    const row = page.locator("tbody tr").filter({ hasText: filename });
    await expect(row).toBeVisible();
    await expect(row.getByText("completed", { exact: true })).toBeVisible({ timeout: 90_000 });

    await row.getByRole("button", { name: "View details" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(filename);
    await expect(dialog).toContainText("Northwind");
    await expect(dialog).toContainText("cloud hosting subscription");
    await expect(dialog).toContainText("120");
    await expect(dialog).toContainText(NORMALIZED_TEXT);

    await dialog.getByRole("button", { name: "Close" }).click();
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Confirm delete" }).click();
    await expect(row).toHaveCount(0);
  } finally {
    await rm(pdfPath, { force: true });
  }
});

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
}
