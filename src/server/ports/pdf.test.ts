import { expect, it } from "vitest";
import { FakePdfRenderer } from "@/test/fakes/pdf";
import { fakeRasterPdf } from "@/test/pdf-fixtures";
import { gotenbergPdfRenderer } from "./pdf-gotenberg";
import { pdfRendererContract } from "./pdf.contract";

pdfRendererContract("in-memory", () => {
  const renderer = new FakePdfRenderer();
  return { renderer, failNext: () => renderer.failNext() };
});
pdfRendererContract("Gotenberg adapter", () => {
  let fail = false;
  const renderer = gotenbergPdfRenderer({
    baseUrl: "http://renderer.test",
    fetch: async () => {
      if (fail) {
        fail = false;
        return new Response(null, { status: 502 });
      }
      return new Response(Buffer.from(fakeRasterPdf()));
    },
  });
  return {
    renderer,
    failNext: () => {
      fail = true;
    },
  };
});

it("rejects a truncated response that has only a PDF header", async () => {
  const renderer = gotenbergPdfRenderer({
    baseUrl: "http://renderer.test",
    fetch: async () => new Response("%PDF-1.7\n"),
  });
  const { contractPdfJob } = await import("./pdf.contract");
  await expect(renderer.render(contractPdfJob)).rejects.toMatchObject({
    name: "PdfRenderError",
  });
});
