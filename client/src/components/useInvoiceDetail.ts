import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { fetchInvoice } from "../api/invoices";
import type { InvoiceRow } from "../state/invoices";

export type InvoiceDetailState =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "ready"; readonly invoice: InvoiceRow };

export function useInvoiceDetail(id: string): InvoiceDetailState {
  const [state, setState] = useState<InvoiceDetailState>({ phase: "loading" });
  useEffect(() => loadInvoiceDetail(id, setState), [id]);
  return state;
}

function loadInvoiceDetail(id: string, setState: Dispatch<SetStateAction<InvoiceDetailState>>): () => void {
  let active = true;
  setState({ phase: "loading" });
  fetchInvoice(id)
    .then((invoice) => {
      if (active) {
        setState({ phase: "ready", invoice });
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      if (active) {
        setState({ phase: "error", message: detailError(error) });
      }
    });
  return () => {
    active = false;
  };
}

function detailError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Could not load invoice details.";
}
