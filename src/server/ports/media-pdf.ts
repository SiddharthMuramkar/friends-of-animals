// Raster-only, blind-judging copy of an essay PDF (#96). Poppler renders
// each page without annotations, to raw RGB pixels. A *new* PDF contains
// only those pixels and the page-display instructions. No object from the
// source PDF is copied: no Info/XMP, attachment, font, link, form, action,
// or invisible text. Visible work is preserved, not semantically redacted.
//
// Only worker-media installs pdftoppm. It runs in a private scratch folder
// with no worker credentials in its environment. All diagnostics are
// discarded: an input PDF's names/contents could appear in them.
// Loads in plain Node (worker-media): relative imports only.

import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { deflate } from "node:zlib";

import { PURPOSE_RULES } from "../modules/files/domain/purposes";
import { sniffContentType } from "../modules/files/domain/sniff";
import { MediaError, type PdfProcessor } from "./media";

// At 2,200 pixels on a Letter/A4 page, text remains readable (~190 dpi).
// Rendering one extra page detects a document that exceeds the cap; never
// truncate. Scratch is bounded below worker-media's 1 GiB /tmp allocation.
const PAGE_EDGE = 2200;
export const PDF_MAX_PAGES = 40;
const MAX_PAGE_BYTES = (PAGE_EDGE + 1) ** 2 * 3 + 128;
const MAX_COPY_BYTES = 64 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 120_000;
const compress = promisify(deflate);

type PagePixels = {
  width: number;
  height: number;
  pixels: Buffer;
};

/** A strict reader for the raw P6 files produced by pdftoppm. */
function pixelsOf(ppm: Buffer): PagePixels {
  const header = /^P6\n(\d+) (\d+)\n255\n/.exec(ppm.toString("latin1", 0, 128));
  if (!header) throw new MediaError("media_decode_failed");
  const width = Number(header[1]);
  const height = Number(header[2]);
  const pixels = ppm.subarray(header[0].length);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > PAGE_EDGE + 1 ||
    height > PAGE_EDGE + 1 ||
    pixels.length !== width * height * 3
  )
    throw new MediaError("media_decode_failed");
  return { width, height, pixels };
}

/**
 * The new file's entire PDF grammar is built here: a catalog, page tree,
 * and exactly one RGB image XObject per page. Byte offsets refer solely
 * to the buffers generated here, and streams use explicit lengths.
 */
class RasterPdf {
  private readonly parts: Buffer[] = [
    Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1"),
  ];
  private readonly offsets: number[] = [0];
  private length = this.parts[0]!.length;

  constructor(pageCount: number) {
    this.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    const kids = Array.from(
      { length: pageCount },
      (_, i) => `${3 + i * 3} 0 R`
    );
    this.object(
      2,
      `<< /Type /Pages /Count ${pageCount} /Kids [${kids.join(" ")}] >>`
    );
  }

  private append(part: string | Buffer) {
    const bytes = typeof part === "string" ? Buffer.from(part, "ascii") : part;
    this.length += bytes.length;
    if (this.length > MAX_COPY_BYTES) throw new MediaError("pdf_too_large");
    this.parts.push(bytes);
  }

  private object(id: number, dictionary: string, stream?: Buffer) {
    this.offsets[id] = this.length;
    this.append(`${id} 0 obj\n${dictionary}\n`);
    if (stream) {
      this.append("stream\n");
      this.append(stream);
      this.append("\nendstream\n");
    }
    this.append("endobj\n");
  }

  async page(index: number, { width, height, pixels }: PagePixels) {
    const page = 3 + index * 3;
    const image = page + 1;
    const contents = page + 2;
    // Keep the rendered aspect ratio; normalise page points to a standard
    // paper-size long edge. No original page dictionaries are reused.
    const scale = 842 / Math.max(width, height);
    const w = (width * scale).toFixed(3);
    const h = (height * scale).toFixed(3);
    this.object(
      page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /PageImage ${image} 0 R >> >> /Contents ${contents} 0 R >>`
    );
    const encoded = await compress(pixels);
    this.object(
      image,
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${encoded.length} >>`,
      encoded
    );
    const paint = Buffer.from(
      `q\n${w} 0 0 ${h} 0 0 cm\n/PageImage Do\nQ\n`,
      "ascii"
    );
    this.object(contents, `<< /Length ${paint.length} >>`, paint);
  }

  finish(): Buffer {
    const xref = this.length;
    this.append(`xref\n0 ${this.offsets.length}\n0000000000 65535 f \n`);
    for (const offset of this.offsets.slice(1)) {
      this.append(`${String(offset).padStart(10, "0")} 00000 n \n`);
    }
    this.append(
      `trailer\n<< /Size ${this.offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    );
    return Buffer.concat(this.parts, this.length);
  }
}

/** A renderer warning can mean skipped or damaged content even on exit 0. */
function renderPages(
  command: string,
  folder: string,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      [
        "-cropbox",
        "-hide-annotations",
        "-scale-to",
        String(PAGE_EDGE),
        "-f",
        "1",
        "-l",
        String(PDF_MAX_PAGES + 1),
        "-forcenum",
        "original.pdf",
        "page",
      ],
      {
        cwd: folder,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        stdio: ["ignore", "ignore", "pipe"],
      }
    );
    let warned = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    // Drain but never store, report or include the renderer's output.
    child.stderr.on("data", () => {
      warned = true;
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("The PDF renderer could not start"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new MediaError("media_timeout"));
      else if (code === null || code === 2)
        reject(new Error("The PDF renderer did not finish"));
      else if (code !== 0 || warned)
        reject(new MediaError("media_decode_failed"));
      else resolve();
    });
  });
}

export function popplerPdfProcessor(
  options: {
    pdftoppm?: string;
    tmpRoot?: string;
    timeoutMs?: number;
  } = {}
): PdfProcessor {
  return {
    async processPdf({ bytes }) {
      if (sniffContentType(bytes) !== "application/pdf") {
        throw new MediaError("unsupported_type");
      }
      if (bytes.length > PURPOSE_RULES.entry_document.maxBytes) {
        throw new MediaError("pdf_too_large");
      }
      const folder = await mkdtemp(
        join(options.tmpRoot ?? tmpdir(), "foa-pdf-")
      );
      try {
        await writeFile(join(folder, "original.pdf"), bytes, { mode: 0o600 });
        await renderPages(
          options.pdftoppm ?? "pdftoppm",
          folder,
          options.timeoutMs ?? RENDER_TIMEOUT_MS
        );
        const pages = (await readdir(folder))
          .filter((name) => /^page-\d+\.ppm$/.test(name))
          .map((name) => ({ name, number: Number(name.slice(5, -4)) }))
          .sort((a, b) => a.number - b.number);
        if (pages.length > PDF_MAX_PAGES) throw new MediaError("pdf_too_large");
        if (
          pages.length === 0 ||
          pages.some((page, index) => page.number !== index + 1)
        ) {
          throw new MediaError("media_decode_failed");
        }
        const pdf = new RasterPdf(pages.length);
        for (const [index, page] of pages.entries()) {
          const path = join(folder, page.name);
          if ((await stat(path)).size > MAX_PAGE_BYTES)
            throw new MediaError("pdf_too_large");
          await pdf.page(index, pixelsOf(await readFile(path)));
        }
        return {
          kind: "pdf_clean",
          contentType: "application/pdf",
          width: null,
          height: null,
          durationMs: null,
          bytes: pdf.finish(),
        };
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
  };
}
