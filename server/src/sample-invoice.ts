import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

export const SAMPLE_VENDOR = "Northwind Supplies";
export const SAMPLE_LINE_DESCRIPTION = "cloud hosting subscription";
export const SAMPLE_TOTAL = "120.00";
export const SAMPLE_INVOICE_RELATIVE_PATH = "server/fixtures/sample-invoice.pdf";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 72;
const TOP = 720;
const LINE_GAP = 28;
const FONT_SIZE = 14;

export function sampleInvoiceLines(): readonly string[] {
  return ["Invoice", `Vendor: ${SAMPLE_VENDOR}`, SAMPLE_LINE_DESCRIPTION, `Total: ${SAMPLE_TOTAL}`];
}

export async function writeSampleInvoice(filePath: string): Promise<void> {
  const bytes = await renderSampleInvoice();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
}

async function renderSampleInvoice(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = sampleInvoiceLines();
  for (const [index, line] of lines.entries()) {
    page.drawText(line, {
      x: LEFT,
      y: TOP - index * LINE_GAP,
      size: FONT_SIZE,
      font,
    });
  }
  return pdf.save();
}

function defaultFixturePath(): string {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  return path.resolve(repoRoot, SAMPLE_INVOICE_RELATIVE_PATH);
}

function isDirectRun(): boolean {
  const self = path.resolve(fileURLToPath(import.meta.url));
  return process.argv.some((arg) => sameFile(arg, self));
}

function sameFile(entry: string, self: string): boolean {
  if (entry.startsWith("-")) {
    return false;
  }
  const invoked = path.resolve(entry);
  if (process.platform === "win32") {
    return invoked.toLowerCase() === self.toLowerCase();
  }
  return invoked === self;
}

if (isDirectRun()) {
  writeSampleInvoice(defaultFixturePath()).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
