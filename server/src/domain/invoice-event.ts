export interface ProcessInvoiceEvent {
  readonly eventId: string;
  readonly type: "PROCESS_INVOICE";
  readonly invoiceId: string;
  readonly filePath: string;
  readonly mimeType: string;
  readonly timestamp: string;
}
