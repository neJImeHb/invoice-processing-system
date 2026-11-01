import { expect, type Locator, type Page } from "@playwright/test";

const STATUS_TIMEOUT = 90_000;

export async function moveOffFailed(page: Page, row: Locator, filename: string): Promise<void> {
  await armStatusLog(page, filename);
  const sawUploaded = expect.poll(() => statusLog(page, filename), { timeout: STATUS_TIMEOUT }).toContain("uploaded");
  await row.getByRole("button", { name: "Retry", exact: true }).click();
  await sawUploaded;
  await expect.poll(() => hasStatusAfterUpload(page, filename, ["processing", "failed"]), { timeout: STATUS_TIMEOUT }).toBe(true);
}

export async function doubleClickRetry(page: Page, row: Locator, filename: string): Promise<void> {
  await armStatusLog(page, filename);
  const sawRetry = expect.poll(() => leftInitialFailed(page, filename), { timeout: STATUS_TIMEOUT }).toBe(true);
  await row.getByRole("button", { name: "Retry", exact: true }).dblclick();
  await sawRetry;
  await expect.poll(() => settledBackToFailed(page, filename), { timeout: STATUS_TIMEOUT }).toBe(true);
}

async function armStatusLog(page: Page, filename: string): Promise<void> {
  await page.evaluate(installStatusLog, filename);
}

function statusLog(page: Page, filename: string): Promise<string[]> {
  return page.evaluate(readStatusLog, filename);
}

async function leftInitialFailed(page: Page, filename: string): Promise<boolean> {
  const statuses = await statusLog(page, filename);
  return statuses.slice(1).some((status) => status === "uploaded" || status === "processing");
}

async function settledBackToFailed(page: Page, filename: string): Promise<boolean> {
  const statuses = await statusLog(page, filename);
  const progressedAt = statuses.findIndex(
    (status, index) => index > 0 && (status === "uploaded" || status === "processing"),
  );
  if (progressedAt === -1) {
    return false;
  }
  return statuses.slice(progressedAt + 1).includes("failed");
}

async function hasStatusAfterUpload(page: Page, filename: string, wanted: readonly string[]): Promise<boolean> {
  const statuses = await statusLog(page, filename);
  const uploadedAt = statuses.indexOf("uploaded");
  if (uploadedAt === -1) {
    return false;
  }
  return statuses.slice(uploadedAt + 1).some((status) => wanted.includes(status));
}

function installStatusLog(filename: string): void {
  const view = window as Window & { __invoiceStatusLog?: Record<string, string[]> };
  const logs = view.__invoiceStatusLog ?? {};
  view.__invoiceStatusLog = logs;
  const seen = logs[filename] ?? [];
  logs[filename] = seen;
  const note = (text: string): void => {
    const status = ["uploaded", "processing", "completed", "failed"].find((word) => text.includes(word));
    if (status !== undefined && seen[seen.length - 1] !== status) {
      seen.push(status);
    }
  };
  const record = (mutations: MutationRecord[]): void => {
    const row = rowElement(filename);
    for (const mutation of mutations) {
      if (row === undefined || !row.contains(mutation.target)) {
        continue;
      }
      note(joinedText(mutation.removedNodes));
      note(joinedText(mutation.addedNodes));
      if (mutation.type === "characterData") {
        note(mutation.target.textContent ?? "");
      }
    }
    note(row?.textContent ?? "");
  };
  note(rowElement(filename)?.textContent ?? "");
  const tbody = document.querySelector("tbody");
  if (tbody === null) {
    throw new Error("invoice table was not rendered");
  }
  new MutationObserver(record).observe(tbody, { subtree: true, childList: true, characterData: true });

  function rowElement(name: string): Element | undefined {
    return Array.from(document.querySelectorAll("tbody tr")).find((candidate) =>
      (candidate.textContent ?? "").includes(name),
    );
  }

  function joinedText(nodes: NodeList): string {
    return Array.from(nodes)
      .map((node) => node.textContent ?? "")
      .join(" ");
  }
}

function readStatusLog(filename: string): string[] {
  const view = window as Window & { __invoiceStatusLog?: Record<string, string[]> };
  return view.__invoiceStatusLog?.[filename] ?? [];
}
