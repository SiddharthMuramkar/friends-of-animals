import type { CertificateDocument } from "../modules/certificates/document";
export type PdfJob = {
  template: "certificate";
  version: number;
  data: CertificateDocument;
};
export interface PdfRenderer {
  render(job: PdfJob): Promise<Uint8Array>;
}
export class PdfRenderError extends Error {
  override name = "PdfRenderError";
  constructor(readonly status?: number) {
    super(
      status
        ? `PDF renderer returned HTTP ${status}`
        : "PDF renderer unavailable"
    );
  }
}
export const unconfiguredPdfRenderer: PdfRenderer = {
  render: async () => {
    throw new PdfRenderError();
  },
};
