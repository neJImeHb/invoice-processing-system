const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

const uploadDateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < FILE_SIZE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const label = FILE_SIZE_UNITS[unit] ?? "B";
  const shown = unit === 0 ? String(Math.round(size)) : trimTrailingZero(size.toFixed(1));
  return `${shown} ${label}`;
}

export function formatUploadDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return uploadDateFormat.format(parsed);
}

export function displayFileName(originalName: string): string {
  const slash = Math.max(originalName.lastIndexOf("/"), originalName.lastIndexOf("\\"));
  if (slash === -1) {
    return originalName;
  }
  return originalName.slice(slash + 1);
}

function trimTrailingZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}
