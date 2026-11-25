// Real pdf_clean adapter, using the same Poppler suite as worker-media.
// In addition to the shared provider contract, independently read the
// actual file's metadata, attachments, page count and embedded pixels.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";

import { essayPdf, PDF_IDENTITY_MARKER } from "@/test/pdf-fixtures";

import { pdfProcessorContract } from "./media.contract";
import { PDF_MAX_PAGES, popplerPdfProcessor } from "./media-pdf";

const run = promisify(execFile);
const processor = popplerPdfProcessor();

pdfProcessorContract("popplerPdfProcessor", async () => ({ processor }));

const scratch = await mkdtemp(join(tmpdir(), "foa-pdf-test-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));

describe("popplerPdfProcessor with real Poppler", () => {
  it("keeps all pages and their visible work but no hidden PDF objects", async () => {
    const original = join(scratch, "source.pdf");
    const copy = join(scratch, "copy.pdf");
    const bytes = essayPdf();
    await writeFile(original, bytes);
    await writeFile(copy, (await processor.processPdf({ bytes })).bytes);

    expect((await run("pdfinfo", [original])).stdout).toContain(
      PDF_IDENTITY_MARKER
    );
    expect((await run("pdfinfo", ["-meta", original])).stdout).toContain(
      PDF_IDENTITY_MARKER
    );
    expect((await run("pdftotext", [original, "-"])).stdout).toContain(
      PDF_IDENTITY_MARKER
    );
    const info = (await run("pdfinfo", [copy])).stdout;
    expect(info).toMatch(/Pages:\s+2\b/);
    expect(info).not.toContain(PDF_IDENTITY_MARKER);
    expect(info).not.toMatch(/(?:Author|Title|Creator|Producer):/);
    expect((await run("pdfinfo", ["-meta", copy])).stdout.trim()).toBe("");
    expect(info).toMatch(/JavaScript:\s+no/);
    expect((await run("pdfdetach", ["-list", copy])).stdout).toContain(
      "0 embedded files"
    );
    expect((await run("pdftotext", [copy, "-"])).stdout.trim()).toBe("");

    // pdfimages decodes actual embedded RGB streams, not a regex on the
    // PDF. Compare them with a render of every page without annotations.
    await run("pdfimages", [copy, join(scratch, "derived")]);
    await run("pdftoppm", [
      "-hide-annotations",
      "-scale-to",
      "2200",
      original,
      join(scratch, "expected"),
    ]);
    // Also render the original normally, proving the annotation actually
    // would have been visible (not just a string in the fixture).
    await run("pdftoppm", [
      "-scale-to",
      "2200",
      "-f",
      "1",
      "-l",
      "1",
      original,
      join(scratch, "annotated"),
    ]);
    const expected = await readFile(join(scratch, "expected-1.ppm"));
    const annotated = await readFile(join(scratch, "annotated-1.ppm"));
    expect(annotated.equals(expected)).toBe(false);
    expect(
      (await readFile(join(scratch, "derived-000.ppm"))).equals(expected)
    ).toBe(true);
    expect(
      (await readFile(join(scratch, "derived-001.ppm"))).equals(
        await readFile(join(scratch, "expected-2.ppm"))
      )
    ).toBe(true);
  });

  it("refuses an over-limit document instead of returning truncated work", async () => {
    await expect(
      processor.processPdf({ bytes: essayPdf(PDF_MAX_PAGES + 1) })
    ).rejects.toMatchObject({ code: "pdf_too_large" });
  });

  it("fails closed on timeout and removes the temporary original", async () => {
    const root = await mkdtemp(join(scratch, "timeout-"));
    const stalled = popplerPdfProcessor({ tmpRoot: root, timeoutMs: 1 });
    await expect(
      stalled.processPdf({ bytes: essayPdf() })
    ).rejects.toMatchObject({ code: "media_timeout" });
    expect(await readdir(root)).toEqual([]);
  });
});
