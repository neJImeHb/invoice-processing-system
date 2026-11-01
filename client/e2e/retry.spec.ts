import { rm, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  collectRetryStatuses,
  doubleClickRetry,
  encryptedPdf,
  expectSettledRetry,
  invoiceRow,
  moveOffFailed,
  normalPdf,
  tempPdfPath,
  uniquePdfName,
  uploadFailedEncrypted,
  uploadPdf,
} from "./retry-flow";

test("encrypted invoice retries once and a completed invoice has no Retry button", async ({ page, request }) => {
  const encryptedName = uniquePdfName("enc");
  const normalName = uniquePdfName("ok");
  const encryptedPath = tempPdfPath(encryptedName);
  const normalPath = tempPdfPath(normalName);
  await writeFile(encryptedPath, encryptedPdf());
  await writeFile(normalPath, normalPdf());
  try {
    await page.goto("/");
    const encrypted = await uploadFailedEncrypted(page, encryptedPath, encryptedName);
    await moveOffFailed(page, encrypted.row, encryptedName);
    await expectSettledRetry(request, encrypted.id);
    await expect(encrypted.row.getByText("failed", { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(encrypted.row.getByText("Invoice file is encrypted", { exact: true })).toBeVisible({
      timeout: 90_000,
    });

    await uploadPdf(page, normalPath);
    const normalRow = invoiceRow(page, normalName);
    await expect(normalRow.getByText("completed", { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(normalRow.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  } finally {
    await rm(encryptedPath, { force: true });
    await rm(normalPath, { force: true });
  }
});

test("double-clicking Retry accepts a single retry", async ({ page, request }) => {
  const filename = uniquePdfName("dbl");
  const pdfPath = tempPdfPath(filename);
  await writeFile(pdfPath, encryptedPdf());
  const statuses: number[] = [];
  try {
    await page.goto("/");
    const uploaded = await uploadFailedEncrypted(page, pdfPath, filename);
    collectRetryStatuses(page, uploaded.id, statuses);
    await doubleClickRetry(page, uploaded.row, filename);
    await expectSettledRetry(request, uploaded.id);
    await expect.poll(() => statuses.filter((status) => status === 200).length, { timeout: 90_000 }).toBe(1);
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
  } finally {
    await rm(pdfPath, { force: true });
  }
});
