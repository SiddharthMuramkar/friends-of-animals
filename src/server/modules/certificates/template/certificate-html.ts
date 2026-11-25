import { readFileSync } from "node:fs";
import { join } from "node:path";
import messages from "../../../../../messages/en-IN/certificatePdf.json";
const words = messages.certificatePdf;
import type { CertificateDocument } from "../document";
import { qrSvg } from "./qr";
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
}
export function certificateHtml(doc: CertificateDocument) {
  const logo = readFileSync(
    join(process.cwd(), "public/brand/foa-logo.svg"),
    "utf8"
  );
  const date = [doc.issuedOn.day, doc.issuedOn.month, doc.issuedOn.year]
    .map((x) => String(x).padStart(2, "0"))
    .join("/");
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><title>${escape(words.title[doc.type])}</title><style>@page{size:A4 landscape;margin:0}*{box-sizing:border-box}body{margin:0;background:white;color:#202829;font:18pt 'Noto Sans','Noto Sans Devanagari',sans-serif}.frame{margin:10mm;padding:12mm;border:2mm solid #276e49;height:190mm;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:1mm}.logo svg{width:35mm;height:auto}h1,p,h2{margin:0}h1{font-size:29pt}h2{font-size:32pt;max-width:240mm;overflow-wrap:anywhere}.footer{width:100%;display:flex;align-items:end;justify-content:space-between;text-align:left;font-size:12pt}.qr svg{width:34mm;height:34mm}.qr{text-align:center}.small{font-size:10pt}</style></head><body><main class="frame"><div class="logo">${logo}</div><h1>${escape(words.title[doc.type])}</h1><p>${escape(words.presented)}</p><h2>${escape(doc.recipientName)}</h2><p>${doc.competition ? `${escape(words.recognition)} <b>${escape(doc.competition.name)}</b> (${escape(doc.competition.code)})` : escape(words.volunteer)}</p>${doc.approvedMinutes != null ? `<p>${escape(words.approvedService.replace("{hours}", String(Math.floor(doc.approvedMinutes / 60))).replace("{minutes}", String(doc.approvedMinutes % 60)))}</p>` : ""}${doc.awardLabel || doc.awardPosition ? `<p>${escape(doc.awardLabel?.replaceAll("_", " ") ?? `Position ${doc.awardPosition}`)}</p>` : ""}<div class="footer"><div><p>${escape(doc.number)}</p><p>${date}</p>${doc.signatories.map((s) => `<p>${escape(s.name)} · ${escape(s.title)}</p>${s.sample ? `<p class="small">${escape(words.sample)}</p>` : ""}`).join("")}</div><div class="qr">${qrSvg(doc.verifyUrl)}<p class="small">${escape(words.verify)}</p></div></div></main></body></html>`;
}
