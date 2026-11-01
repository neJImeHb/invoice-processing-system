import type { InvoiceRow } from "../state/invoices";
import { displayAmount, readInvoiceExtraction, type InvoiceExtractionView, type LineItemDetail } from "./extracted-detail";
import { InvoiceFilePreview } from "./InvoiceFilePreview";

export function CompletedInvoice({ invoice }: { readonly invoice: InvoiceRow }) {
  const extracted = readInvoiceExtraction(invoice.extracted_data);
  return (
    <div className="space-y-4">
      <InvoiceFilePreview id={invoice.id} mimeType={invoice.mime_type} />
      <ExtractionSummary extracted={extracted} />
      <LineItemTable items={extracted.lineItems} />
      <NormalizedText value={invoice.normalized_text} />
    </div>
  );
}

function ExtractionSummary({ extracted }: { readonly extracted: InvoiceExtractionView }) {
  return (
    <dl className="grid gap-3 text-sm text-slate-800 sm:grid-cols-2">
      <Field label="Vendor" value={extracted.vendor} />
      <Field label="Invoice number" value={extracted.invoiceNumber} />
      <Field label="Issue date" value={extracted.issueDate} />
      <Field label="Due date" value={extracted.dueDate} />
      <Field label="Currency" value={extracted.currency} />
      <AmountField amount={extracted.tax} label="Tax" />
      <AmountField amount={extracted.total} label="Grand total" />
    </dl>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="font-medium text-slate-600">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function AmountField({ label, amount }: { readonly label: string; readonly amount: number | null }) {
  if (amount === null) {
    return <p className="text-sm text-slate-800">{label} is absent</p>;
  }
  return <Field label={label} value={displayAmount(amount)} />;
}

function LineItemTable({ items }: { readonly items: readonly LineItemDetail[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-700">No line items.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <h3 className="mb-2 text-sm font-medium text-slate-600">Line items</h3>
      <table className="min-w-full text-left text-sm">
        <LineHeader />
        <tbody>
          {items.map((item, index) => (
            <LineRow item={item} key={`${item.description}-${String(index)}`} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineHeader() {
  return (
    <thead className="bg-slate-50 text-slate-600">
      <tr>
        <th className="px-3 py-2 font-medium" scope="col">Description</th>
        <th className="px-3 py-2 font-medium" scope="col">Quantity</th>
        <th className="px-3 py-2 font-medium" scope="col">Unit price</th>
        <th className="px-3 py-2 font-medium" scope="col">Total</th>
      </tr>
    </thead>
  );
}

function LineRow({ item }: { readonly item: LineItemDetail }) {
  return (
    <tr className="border-t border-slate-200">
      <td className="px-3 py-2">{item.description}</td>
      <td className="px-3 py-2">{displayAmount(item.quantity)}</td>
      <td className="px-3 py-2">{displayAmount(item.unitPrice)}</td>
      <td className="px-3 py-2">{displayAmount(item.total)}</td>
    </tr>
  );
}

function NormalizedText({ value }: { readonly value: string | null }) {
  const text = value === null || value.trim().length === 0 ? "absent" : value;
  return (
    <section className="space-y-1">
      <h3 className="text-sm font-medium text-slate-600">Normalized text</h3>
      <p className="whitespace-pre-wrap text-sm text-slate-800">{text}</p>
    </section>
  );
}
