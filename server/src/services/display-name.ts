import path from "node:path";

export function displayName(clientName: string, extension: string): string {
  const normalized = clientName.replaceAll("\\", "/");
  const base = path.posix.basename(normalized);
  if (base.length === 0 || base.includes("/") || base.includes("\\")) {
    return `invoice${extension}`;
  }
  return base;
}
