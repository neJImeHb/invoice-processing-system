const PDF_PREFIX = Buffer.from("%PDF");
const PNG_PREFIX = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_PREFIX = Buffer.from([0xff, 0xd8, 0xff]);

export type StoredMimeType = "application/pdf" | "image/png" | "image/jpeg";
export type StoredExtension = ".pdf" | ".png" | ".jpg";

export interface AcceptedUpload {
  readonly mimeType: StoredMimeType;
  readonly extension: StoredExtension;
}

const ACCEPTED: readonly AcceptedUpload[] = [
  { mimeType: "application/pdf", extension: ".pdf" },
  { mimeType: "image/png", extension: ".png" },
  { mimeType: "image/jpeg", extension: ".jpg" },
];

function prefixFor(mimeType: StoredMimeType): Uint8Array {
  if (mimeType === "application/pdf") {
    return PDF_PREFIX;
  }
  if (mimeType === "image/png") {
    return PNG_PREFIX;
  }
  return JPEG_PREFIX;
}

function matchesPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.byteLength < prefix.byteLength) {
    return false;
  }
  for (let index = 0; index < prefix.byteLength; index += 1) {
    if (bytes[index] !== prefix[index]) {
      return false;
    }
  }
  return true;
}

function declaredBase(declaredType: string): string {
  const separator = declaredType.indexOf(";");
  const base = separator === -1 ? declaredType : declaredType.slice(0, separator);
  return base.trim().toLowerCase();
}

export function resolveAcceptedFile(declaredType: string, bytes: Uint8Array): AcceptedUpload | undefined {
  const declared = declaredBase(declaredType);
  const match = ACCEPTED.find((item) => item.mimeType === declared);
  if (match === undefined) {
    return undefined;
  }
  if (!matchesPrefix(bytes, prefixFor(match.mimeType))) {
    return undefined;
  }
  return match;
}
