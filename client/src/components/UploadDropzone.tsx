import { useState, type ChangeEvent, type DragEvent } from "react";
import { clientUploadError, uploadInvoiceFile } from "../api/upload";
import { invoiceFromUpload, type InvoiceRow } from "../state/invoices";

interface UploadDropzoneProps {
  readonly onUploaded: (row: InvoiceRow) => void;
}

export function UploadDropzone({ onUploaded }: UploadDropzoneProps) {
  const controller = useUploadController(onUploaded);
  return (
    <div
      className="rounded-lg border-2 border-dashed border-slate-300 bg-white px-6 py-8 text-center"
      onDragEnter={allowDrop}
      onDragOver={allowDrop}
      onDrop={(event) => {
        onDropFile(event, controller.busy, controller.upload);
      }}
    >
      <p className="text-sm text-slate-700">Drop a PDF, PNG, or JPEG here, or choose a file</p>
      <FileInput disabled={controller.busy} onFile={controller.upload} />
      <UploadProgress percent={controller.percent} />
      <UploadError message={controller.error} />
    </div>
  );
}

function useUploadController(onUploaded: (row: InvoiceRow) => void) {
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = (file: File): void => {
    beginUpload(file, onUploaded, setPercent, setError);
  };
  return { percent, error, busy: percent !== null, upload };
}

function beginUpload(
  file: File,
  onUploaded: (row: InvoiceRow) => void,
  setPercent: (percent: number | null) => void,
  setError: (message: string | null) => void,
): void {
  const rejected = clientUploadError(file);
  if (rejected !== null) {
    setPercent(null);
    setError(rejected);
    return;
  }
  setError(null);
  setPercent(0);
  uploadInvoiceFile(file, setPercent)
    .then((accepted) => {
      onUploaded(invoiceFromUpload(accepted, { size: file.size, type: file.type }));
      setPercent(null);
    })
    .catch((error: unknown) => {
      console.error(error);
      setPercent(null);
      setError(error instanceof Error ? error.message : "The upload failed.");
    });
}

function FileInput({ disabled, onFile }: { readonly disabled: boolean; readonly onFile: (file: File) => void }) {
  return (
    <div className="mt-3">
      <label className="text-sm font-medium text-slate-800" htmlFor="invoice-file">
        Choose invoice file
      </label>
      <input
        accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
        className="mt-2 block w-full text-sm"
        disabled={disabled}
        id="invoice-file"
        onChange={(event) => {
          takeFile(event, onFile);
        }}
        type="file"
      />
    </div>
  );
}

function UploadProgress({ percent }: { readonly percent: number | null }) {
  if (percent === null) {
    return null;
  }
  return (
    <p
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className="mt-4 text-sm font-medium text-slate-800"
      role="progressbar"
    >
      {percent}%
    </p>
  );
}

function UploadError({ message }: { readonly message: string | null }) {
  if (message === null) {
    return null;
  }
  return (
    <p className="mt-4 text-sm font-medium text-red-700" role="alert">
      {message}
    </p>
  );
}

function onDropFile(event: DragEvent<HTMLDivElement>, busy: boolean, upload: (file: File) => void): void {
  event.preventDefault();
  if (busy) {
    return;
  }
  const file = firstFile(event.dataTransfer.files);
  if (file !== undefined) {
    upload(file);
  }
}

function allowDrop(event: DragEvent<HTMLDivElement>): void {
  event.preventDefault();
}

function takeFile(event: ChangeEvent<HTMLInputElement>, onFile: (file: File) => void): void {
  const file = firstFile(event.target.files);
  event.target.value = "";
  if (file !== undefined) {
    onFile(file);
  }
}

function firstFile(list: FileList | null): File | undefined {
  if (list === null || list.length === 0) {
    return undefined;
  }
  return list[0];
}
