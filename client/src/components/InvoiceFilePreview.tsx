import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { invoiceFilePath } from "../api/invoices";

interface FilePreviewProps {
  readonly id: string;
  readonly mimeType: string;
}

export function InvoiceFilePreview({ id, mimeType }: FilePreviewProps) {
  const url = useInvoiceFileUrl(id);
  if (url === undefined) {
    return <p>Loading original file…</p>;
  }
  if (url === null) {
    return <p role="alert">The original file could not be loaded.</p>;
  }
  if (mimeType.startsWith("image/")) {
    return <img alt="Original invoice" className="max-h-96 max-w-full rounded border border-slate-200" src={url} />;
  }
  return <iframe className="h-96 w-full rounded border border-slate-200" src={url} title="Original invoice" />;
}

function useInvoiceFileUrl(id: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => subscribeToFile(id, setUrl), [id]);
  return url;
}

function subscribeToFile(id: string, setUrl: Dispatch<SetStateAction<string | null | undefined>>): () => void {
  let active = true;
  let objectUrl: string | undefined;
  setUrl(undefined);
  fetch(invoiceFilePath(id))
    .then((response) => readFileBlob(response))
    .then((blob) => {
      publishFileUrl(blob, () => active, (next) => {
        objectUrl = next;
      }, setUrl);
    })
    .catch((error: unknown) => {
      console.error(error);
      if (active) {
        setUrl(null);
      }
    });
  return () => {
    active = false;
    revokeUrl(objectUrl);
  };
}

function publishFileUrl(
  blob: Blob,
  isActive: () => boolean,
  remember: (url: string) => void,
  setUrl: (url: string) => void,
): void {
  const next = URL.createObjectURL(blob);
  if (!isActive()) {
    URL.revokeObjectURL(next);
    return;
  }
  remember(next);
  setUrl(next);
}

function revokeUrl(url: string | undefined): void {
  if (url !== undefined) {
    URL.revokeObjectURL(url);
  }
}

async function readFileBlob(response: Response): Promise<Blob> {
  if (!response.ok) {
    throw new Error(`The original file could not be loaded (${String(response.status)}).`);
  }
  return response.blob();
}
