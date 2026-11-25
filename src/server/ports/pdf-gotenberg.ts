import { certificateHtml } from "../modules/certificates/template/certificate-html";
import { PdfRenderError, type PdfRenderer } from "./pdf";
/** Worker-media only; no URL conversion or remote assets. */
export function gotenbergPdfRenderer({
  baseUrl,
  fetch: request = fetch,
  timeoutMs = 60000,
}: {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): PdfRenderer {
  return {
    async render(job) {
      try {
        const body = new FormData();
        body.set(
          "files",
          new Blob([certificateHtml(job.data)], { type: "text/html" }),
          "index.html"
        );
        for (const [key, value] of Object.entries({
          paperSize: "A4",
          landscape: "true",
          marginTop: "0",
          marginBottom: "0",
          marginLeft: "0",
          marginRight: "0",
          preferCssPageSize: "true",
          printBackground: "true",
          nativeTaggedPdf: "true",
        }))
          body.set(key, value);
        const response = await request(
          new URL("/forms/chromium/convert/html", baseUrl),
          {
            method: "POST",
            body,
            signal: AbortSignal.timeout(timeoutMs),
            redirect: "error",
          }
        );
        if (!response.ok) throw new PdfRenderError(response.status);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
          throw new PdfRenderError();
        return bytes;
      } catch (error) {
        throw error instanceof PdfRenderError ? error : new PdfRenderError();
      }
    },
  };
}
