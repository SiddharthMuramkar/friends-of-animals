// A tiny, well-formed essay PDF fixture with a marker in its document
// Info, a visible annotation and attachment. All identifiers are fictional.
// Pages display plain essay text and a blue rectangle, not the marker.
// Test code only. A valid cross-reference table means the real adapter
// need not repair the file before rendering it.

export const PDF_IDENTITY_MARKER = "Fictional Author Metadata 12345";

export function essayPdf(pageCount = 2): Uint8Array {
  const parts = ["%PDF-1.4\n"];
  const offsets = [0];
  const object = (id: number, body: string) => {
    offsets[id] = parts.join("").length;
    parts.push(`${id} 0 obj\n${body}\nendobj\n`);
  };
  const pages = Array.from({ length: pageCount }, (_, n) => `${9 + n * 2} 0 R`);
  object(
    1,
    "<< /Type /Catalog /Pages 2 0 R /Metadata 8 0 R /Names << /EmbeddedFiles << /Names [(private.txt) 5 0 R] >> >> >>"
  );
  object(
    2,
    `<< /Type /Pages /Kids [${pages.join(" ")}] /Count ${pageCount} >>`
  );
  object(
    3,
    `<< /Author (${PDF_IDENTITY_MARKER}) /Title (${PDF_IDENTITY_MARKER}) >>`
  );
  object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  object(5, "<< /Type /Filespec /F (private.txt) /EF << /F 6 0 R >> >>");
  object(
    6,
    `<< /Type /EmbeddedFile /Length ${PDF_IDENTITY_MARKER.length} >>\nstream\n${PDF_IDENTITY_MARKER}\nendstream`
  );
  // A genuine displayed annotation. Rendering with annotations enabled
  // would show its red border over the top-right corner of the page.
  object(
    7,
    `<< /Type /Annot /Subtype /Link /Rect [250 300 350 390] /Border [0 0 5] /C [1 0 0] /Contents (${PDF_IDENTITY_MARKER}) /A << /S /URI /URI (https://example.invalid/private) >> >>`
  );
  const xmp = `<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="${PDF_IDENTITY_MARKER}"/></rdf:RDF></x:xmpmeta>`;
  object(
    8,
    `<< /Type /Metadata /Subtype /XML /Length ${xmp.length} >>\nstream\n${xmp}\nendstream`
  );
  for (let n = 0; n < pageCount; n += 1) {
    const page = 9 + n * 2;
    object(
      page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 4 0 R >> >> /Contents ${page + 1} 0 R ${n === 0 ? "/Annots [7 0 R]" : ""} >>`
    );
    const work = `BT /F1 20 Tf 30 220 Td (Kindness to animals - page ${n + 1}) Tj ET\nBT /F1 10 Tf 3 Tr 20 200 Td (${PDF_IDENTITY_MARKER}) Tj ET\n0 0 1 rg 30 30 100 50 re f\n`;
    object(page + 1, `<< /Length ${work.length} >>\nstream\n${work}endstream`);
  }
  const xref = parts.join("").length;
  parts.push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) {
    parts.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  parts.push(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  );
  return new TextEncoder().encode(parts.join(""));
}
