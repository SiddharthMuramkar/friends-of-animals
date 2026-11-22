import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import rawArt from "@/assets/site-art/art.json";

import { ART_FOLDERS, SITE_ART_IDS, art, artSchema } from "./art";

const dir = path.join(import.meta.dirname, "../../assets/site-art");
const filesOnDisk = readdirSync(dir, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".webp"))
  .map((f) => f.split(path.sep).join("/"))
  .sort();
const read = (file: string) => readFileSync(path.join(dir, file));

/** Every .ts/.tsx under src outside the art registry and the style guide. */
function sourceText(): string {
  const src = path.join(import.meta.dirname, "../..");
  return (
    readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
      .filter((f) => !f.split(path.sep).join("/").startsWith("lib/art/"))
      // The style guide shows art; it doesn't count as a place on the site.
      .filter((f) => !f.split(path.sep).join("/").startsWith("app/styleguide/"))
      .map((f) => readFileSync(path.join(src, f), "utf8"))
      .join("\n")
  );
}

describe("art.json (AI illustrations, ADR 0003)", () => {
  it("parses against the schema", () => {
    expect(art.length).toBe(rawArt.length);
    for (const entry of rawArt) artSchema.parse(entry);
  });

  it("has an entry for every illustration file, and a file for every entry", () => {
    const files = art.map((a) => a.file).sort();
    expect(files).toEqual(filesOnDisk);
  });

  it("matches the generated id list exactly", () => {
    expect(art.map((a) => a.id).sort()).toEqual([...SITE_ART_IDS].sort());
  });

  it("keeps files in the known folders", () => {
    for (const a of art) {
      expect(ART_FOLDERS as readonly string[]).toContain(a.file.split("/")[0]);
    }
  });

  it("records each file's real size and hash", () => {
    for (const a of art) {
      const buf = read(a.file);
      expect(buf.length, a.id).toBe(a.bytes);
      expect(createHash("sha256").update(buf).digest("hex"), a.id).toBe(
        a.sha256
      );
    }
  });

  it("embeds the IPTC 'made by AI' marker in every file", () => {
    for (const a of art) {
      expect(read(a.file).includes("trainedAlgorithmicMedia"), a.id).toBe(true);
    }
  });

  it("records each file's real dimensions (a living strip holds all its frames)", async () => {
    for (const a of art) {
      const { width, height } = await sharp(read(a.file)).metadata();
      expect(width, a.id).toBe(a.width * (a.frames ?? 1));
      expect(height, a.id).toBe(a.height);
    }
  });

  it("labels meaningful art as an AI illustration and keeps decorative art silent", () => {
    for (const a of art) {
      if (a.decorative) expect(a.alt, a.id).toBeNull();
      else expect(a.alt?.startsWith("AI illustration: "), a.id).toBe(true);
    }
  });

  it("passed the rubric panel, and claims no human review that has not happened", () => {
    for (const a of art) {
      expect(a.review.gatesPassed, a.id).toBe(true);
      expect(a.review.mean, a.id).toBeGreaterThanOrEqual(4);
      expect(a.review.humanReviewer, a.id).toBeNull();
    }
  });

  it("uses every illustration somewhere on the site", () => {
    const text = sourceText();
    const unused = art
      .filter((a) => !text.includes(`"${a.id}"`))
      .map((a) => a.id);
    expect(unused).toEqual([]);
  });

  it("keeps art light where it skips the optimizer or repeats across pages", () => {
    // A living strip ships as built (unoptimized), so its file is what every
    // visitor downloads: each frame at most about twice its largest slot.
    const SLOT_PX: Record<string, number> = {
      "living-cat": 96, // footer, sm:w-24
      "living-dog": 120, // home hero, w-30
      "living-sparrow": 224, // /awareness, sm:w-56
    };
    for (const a of art) {
      const folder = a.file.split("/")[0];
      if (a.kind === "living") {
        const slot = SLOT_PX[a.id];
        expect(slot, `${a.id}: add its largest slot width`).toBeDefined();
        expect(a.width, a.id).toBeLessThanOrEqual(Math.ceil((slot ?? 0) * 2.1));
        expect(a.bytes, a.id).toBeLessThanOrEqual(125_000);
      }
      // Small pieces: stickers, the 404's CSS-background portraits, waiting animals.
      if (
        folder === "stickers" ||
        folder === "portraits" ||
        folder === "waiting"
      ) {
        expect(a.bytes, a.id).toBeLessThanOrEqual(20_000);
      }
    }
  });
});
