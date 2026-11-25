import { expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import jsQR from "jsqr";
import { certificateHtml } from "./certificate-html";
import { qrSvg } from "./qr";
import type { CertificateDocument } from "../document";
import { gotenbergPdfRenderer } from "../../../ports/pdf-gotenberg";
const document: CertificateDocument = {
  number: "FOA-C-27-9XQ4M2T7KD",
  type: "winner",
  awardPosition: 1,
  awardLabel: "gold",
  recipientName: "आशा राव <script>alert(1)</script>",
  competition: { code: "PAWS27", name: "Friends & Nature" },
  issuedOn: { year: 2027, month: 3, day: 15 },
  verifyUrl: "https://friendsofanimals.example/verify/FOA-C-27-9XQ4M2T7KD",
  signatories: [{ name: "Sample signatory", title: "FOA", sample: true }],
};
it("renders the approved inline mark, escaped names and a decodable QR with no remote resource", () => {
  const html = certificateHtml(document);
  expect(html).toContain("आशा राव &lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("Noto Sans Devanagari");
  expect(html).toContain('id="tiles"');
  expect(html).toContain("Sample signatory");
  expect(html).not.toMatch(/(?:src|href)=["']https?:/);
  const raster = new Resvg(qrSvg(document.verifyUrl), {
    fitTo: { mode: "width", value: 480 },
  }).render();
  expect(
    jsQR(new Uint8ClampedArray(raster.pixels), raster.width, raster.height)
      ?.data
  ).toBe(document.verifyUrl);
});
it("posts self-contained HTML with A4 landscape and refuses provider failures", async () => {
  let seen: FormData | undefined;
  const renderer = gotenbergPdfRenderer({
    baseUrl: "http://pdf.test:3000",
    fetch: async (url, req) => {
      expect(
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url
      ).toBe("http://pdf.test:3000/forms/chromium/convert/html");
      seen = req?.body as FormData;
      return new Response("%PDF-1.7\n");
    },
  });
  expect(
    await renderer.render({
      template: "certificate",
      version: 1,
      data: document,
    })
  ).toEqual(new TextEncoder().encode("%PDF-1.7\n"));
  expect(seen?.get("paperSize")).toBe("A4");
  expect(seen?.get("landscape")).toBe("true");
  const file = seen?.get("files");
  if (!(file instanceof File)) throw Error("Missing HTML file");
  expect(await file.text()).toContain("Winner certificate");
  const error = gotenbergPdfRenderer({
    baseUrl: "http://pdf.test",
    fetch: async () => new Response("private diagnostics", { status: 502 }),
  });
  await expect(
    error.render({ template: "certificate", version: 1, data: document })
  ).rejects.toMatchObject({ name: "PdfRenderError", status: 502 });
});

it("prints exact approved service minutes on a volunteer certificate with the shared QR", () => {
  const service: CertificateDocument = {
    ...document,
    type: "volunteer_service",
    competition: null,
    awardPosition: null,
    awardLabel: null,
    approvedMinutes: 95,
  };
  const html = certificateHtml(service);
  expect(html).toContain("Approved volunteer service: 1 h 35 min");
  expect(html).not.toContain("Friends &amp; Nature");
  expect(html).toContain("Volunteer service certificate");
});
