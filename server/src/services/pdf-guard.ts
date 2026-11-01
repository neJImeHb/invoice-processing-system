export type FileGuard =
  | { readonly ok: true }
  | { readonly ok: false; readonly errorMessage: string };

export const UNREADABLE_FILE_MESSAGE = "Invoice file is unreadable";

const ENCRYPTED_PDF_MESSAGE = "Invoice file is encrypted";
const ENCRYPTED_MARKER = "/Encrypt";
const EOF_MARKER = "%%EOF";
const PDF_MIME = "application/pdf";

export function guardInvoiceBytes(bytes: Uint8Array, mimeType: string): FileGuard {
  if (bytes.byteLength === 0) {
    return reject(UNREADABLE_FILE_MESSAGE);
  }
  if (mimeType !== PDF_MIME) {
    return { ok: true };
  }
  if (containsAscii(bytes, ENCRYPTED_MARKER)) {
    return reject(ENCRYPTED_PDF_MESSAGE);
  }
  if (!containsAscii(bytes, EOF_MARKER)) {
    return reject(UNREADABLE_FILE_MESSAGE);
  }
  return { ok: true };
}

function reject(errorMessage: string): FileGuard {
  return { ok: false, errorMessage };
}

function containsAscii(bytes: Uint8Array, marker: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(marker, "latin1"));
}
