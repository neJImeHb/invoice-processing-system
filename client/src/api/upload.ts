import type { UploadAcceptance } from "../state/invoices";
import { isRecord } from "./guards";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const UPLOAD_PATH = "/api/invoices/upload";
const ACCEPTED_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg"]);
const ACCEPTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg"];

const UPLOAD_ERROR_TEXT = {
  empty_body: "The upload was empty. Choose a PDF, PNG, or JPEG file.",
  file_too_large: "The file is larger than 20 MB.",
  unsupported_media: "Only PDF, PNG, and JPEG files are accepted.",
  broker_unavailable: "Invoice processing is unavailable. Try again later.",
} as const;

const STATUS_TEXT: Record<number, string> = {
  400: "The upload was rejected. Choose a PDF, PNG, or JPEG file.",
  413: "The file is larger than 20 MB.",
  415: "Only PDF, PNG, and JPEG files are accepted.",
  503: "Invoice processing is unavailable. Try again later.",
};

type UploadErrorCode = keyof typeof UPLOAD_ERROR_TEXT;

export function clientUploadError(file: Pick<File, "name" | "type" | "size">): string | null {
  if (!isAcceptedInvoiceFile(file)) {
    return "Only PDF, PNG, and JPEG files are accepted.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "This file is larger than 20 MB.";
  }
  return null;
}

export function uploadInvoiceFile(file: File, onProgress: (percent: number) => void): Promise<UploadAcceptance> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", UPLOAD_PATH);
    xhr.upload.addEventListener("progress", (event) => {
      onProgress(uploadPercent(event));
    });
    xhr.addEventListener("load", () => {
      settleUpload(xhr, resolve, reject);
    });
    xhr.addEventListener("error", () => {
      reject(new Error("The upload could not be sent."));
    });
    sendFile(xhr, file);
  });
}

function isAcceptedInvoiceFile(file: Pick<File, "name" | "type">): boolean {
  if (ACCEPTED_MIME_TYPES.has(file.type.toLowerCase())) {
    return true;
  }
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function sendFile(xhr: XMLHttpRequest, file: File): void {
  const body = new FormData();
  body.append("file", file);
  xhr.send(body);
}

function uploadPercent(event: ProgressEvent): number {
  if (!event.lengthComputable || event.total <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((event.loaded / event.total) * 100));
}

function settleUpload(
  xhr: XMLHttpRequest,
  resolve: (value: UploadAcceptance) => void,
  reject: (reason: Error) => void,
): void {
  if (xhr.status !== 202) {
    reject(new Error(uploadFailureMessage(xhr.status, xhr.responseText)));
    return;
  }
  try {
    resolve(parseUploadAcceptance(parseJson(xhr.responseText)));
  } catch (error) {
    reject(error instanceof Error ? error : new Error("Upload response was not valid."));
  }
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function parseUploadAcceptance(payload: unknown): UploadAcceptance {
  if (!isRecord(payload)) {
    throw new Error("Upload response was not an object");
  }
  const { id, filename, status } = payload;
  if (!isNonEmptyString(id) || !isNonEmptyString(filename) || status !== "uploaded") {
    throw new Error("Upload response did not include id, filename, and status uploaded");
  }
  return { id, filename, status };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function uploadFailureMessage(status: number, body: string): string {
  const code = readErrorCode(body);
  if (code !== undefined) {
    return messageForCode(code);
  }
  return STATUS_TEXT[status] ?? `The upload failed (${String(status)}).`;
}

function messageForCode(code: string): string {
  if (isUploadErrorCode(code)) {
    return UPLOAD_ERROR_TEXT[code];
  }
  return `Upload failed: ${code}`;
}

function isUploadErrorCode(value: string): value is UploadErrorCode {
  return Object.prototype.hasOwnProperty.call(UPLOAD_ERROR_TEXT, value);
}

function readErrorCode(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    console.error(error);
    return undefined;
  }
  if (!isRecord(payload) || typeof payload.error !== "string" || payload.error.length === 0) {
    return undefined;
  }
  return payload.error;
}
