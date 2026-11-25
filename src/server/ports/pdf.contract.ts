import { describe, expect, it } from "vitest";
import { PdfRenderError, type PdfJob, type PdfRenderer } from "./pdf";

export const contractPdfJob: PdfJob = {
  template: "certificate",
  version: 1,
  data: {
    number: "FOA-C-27-9XQ4M2T7KD",
    type: "winner",
    awardPosition: 1,
    awardLabel: "gold",
    recipientName: "Sample artist",
    competition: { code: "PAWS27", name: "Friends & Nature" },
    issuedOn: { year: 2027, month: 3, day: 15 },
    verifyUrl: "https://example.test/verify/FOA-C-27-9XQ4M2T7KD",
    signatories: [],
  },
};

export function pdfRendererContract(
  name: string,
  setup: () => {
    renderer: PdfRenderer;
    failNext(): void;
  }
) {
  describe(`${name} (PdfRenderer contract)`, () => {
    it("returns a complete one-page PDF as bytes", async () => {
      const { renderer } = setup();
      const bytes = await renderer.render(contractPdfJob);
      expect(bytes).toBeInstanceOf(Uint8Array);
      const pdf = new TextDecoder().decode(bytes);
      expect(pdf).toMatch(/^%PDF-1\.[4-7]/);
      expect(pdf).toContain("/Type /Page ");
      const xref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(pdf);
      expect(xref).not.toBeNull();
      expect(pdf.slice(Number(xref![1]), Number(xref![1]) + 4)).toBe("xref");
    });
    it("rejects a failed provider with the port error and recovers on the next request", async () => {
      const { renderer, failNext } = setup();
      failNext();
      await expect(renderer.render(contractPdfJob)).rejects.toBeInstanceOf(
        PdfRenderError
      );
      await expect(renderer.render(contractPdfJob)).resolves.toBeInstanceOf(
        Uint8Array
      );
    });
  });
}
