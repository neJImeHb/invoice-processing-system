import { isRecord } from "../api/guards";

export function readExtractedSummary(data: unknown): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const vendor = vendorName(data.vendor);
  const total = totalAmount(data.financials);
  if (vendor === undefined || total === undefined) {
    return undefined;
  }
  return `${vendor} · ${total}`;
}

function vendorName(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.name !== "string") {
    return undefined;
  }
  const name = value.name.trim();
  if (name.length === 0) {
    return undefined;
  }
  return name;
}

function totalAmount(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.totalAmount !== "number" || !Number.isFinite(value.totalAmount)) {
    return undefined;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value.totalAmount);
}
