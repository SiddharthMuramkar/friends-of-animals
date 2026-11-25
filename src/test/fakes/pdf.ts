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
    return new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
  }
}
