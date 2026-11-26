import type { PdfJob, PdfRenderer } from "@/server/ports/pdf";
import { PdfRenderError } from "@/server/ports/pdf";
export class FakePdfRenderer implements PdfRenderer {
  readonly rendered: PdfJob[] = [];
  private failures = 0;
  failNext(count = 1) {
    this.failures += count;
  }
  async render(job: PdfJob) {
    this.rendered.push(structuredClone(job));
    if (this.failures > 0) {
      this.failures--;
      throw new PdfRenderError();
    }
    return fakeCertificatePdf(job);
  }
}

/** Complete, inert A4 landscape PDF: exercises downstream PDF delivery and
 * parsing without pretending to reproduce the approved visual template. */
function fakeCertificatePdf(job: PdfJob) {
  const literal = (value: string) =>
    value.replace(/[^\x20-\x7e]/g, "?").replace(/[()\\]/g, "\\$&");
  const text = `BT /F1 18 Tf 48 520 Td (${literal(job.data.number)}) Tj 0 -28 Td (${literal(job.data.recipientName)}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}endstream`,
  ];
  let body = "%PDF-1.7\n";
  let offsets = "0000000000 65535 f \n";
  for (const [index, object] of objects.entries()) {
    offsets += `${String(body.length).padStart(10, "0")} 00000 n \n`;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  return new TextEncoder().encode(
    `${body}xref\n0 6\n${offsets}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF\n`
  );
}
