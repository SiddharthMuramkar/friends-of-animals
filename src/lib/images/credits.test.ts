import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import rawCredits from "@/assets/site-images/credits.json";
import focal from "@/assets/site-images/focal.json";

import {
  LICENCE_URL,
  SITE_IMAGE_IDS,
  creditSchema,
  credits,
  needsVisibleCredit,
  shortCredit,
} from "./credits";

const dir = path.join(import.meta.dirname, "../../assets/site-images");
const filesOnDisk = readdirSync(dir, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".jpg"))
  .map((f) => f.split(path.sep).join("/"))
  .sort();

describe("credits.json", () => {
  it("parses against the schema", () => {
    expect(credits.length).toBe(rawCredits.length);
  });

  it("has an entry for every image file", () => {
    const files = new Set(credits.map((c) => c.file));
    expect(filesOnDisk.filter((f) => !files.has(f))).toEqual([]);
  });

  it("has a file for every entry", () => {
    const onDisk = new Set(filesOnDisk);
    expect(credits.filter((c) => !onDisk.has(c.file))).toEqual([]);
  });

  it("matches the typed id list exactly", () => {
    expect(credits.map((c) => c.id).sort()).toEqual([...SITE_IMAGE_IDS].sort());
  });

  it("has a focal point inside the frame for every image", () => {
    expect(Object.keys(focal).sort()).toEqual([...SITE_IMAGE_IDS].sort());
    for (const [x, y] of Object.values(focal)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it("links each licence to its canonical legal page", () => {
    for (const c of credits) expect(c.licenceUrl).toBe(LICENCE_URL[c.licence]);
  });

  it("gives every image non-empty alt text, a place and a reason", () => {
    for (const c of credits) {
      expect(c.alt.trim().length, c.id).toBeGreaterThan(20);
      expect(
        c.place === null || !/not stated|unknown/i.test(c.place),
        c.id
      ).toBe(true);
      expect(c.whyChosen.trim(), c.id).not.toBe("");
    }
  });

  it("never lists an AI image or an identifiable person", () => {
    for (const c of credits) {
      expect(c.ai).toBe(false);
      expect([
        "none",
        "adult-not-identifiable",
        "child-not-identifiable",
      ]).toContain(c.people);
    }
  });
});

describe("creditSchema", () => {
  const valid = { ...rawCredits[0] };

  it("rejects a licence URL that does not match the licence", () => {
    const bad = {
      ...valid,
      licence: "CC-BY-SA-4.0",
      licenceUrl: LICENCE_URL["CC-BY-4.0"],
    };
    expect(creditSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects empty alt text and AI images", () => {
    expect(creditSchema.safeParse({ ...valid, alt: "" }).success).toBe(false);
    expect(creditSchema.safeParse({ ...valid, ai: true }).success).toBe(false);
  });

  it("rejects a file outside the image themes", () => {
    expect(
      creditSchema.safeParse({ ...valid, file: "misc/x.jpg" }).success
    ).toBe(false);
  });
});

describe("short credit", () => {
  it("names the creator and licence", () => {
    expect(shortCredit({ author: "Slyronit", licence: "CC-BY-SA-4.0" })).toBe(
      "Photo: Slyronit, CC BY-SA 4.0"
    );
    expect(shortCredit({ author: "Aditya Oberai", licence: "Pexels" })).toBe(
      "Photo: Aditya Oberai, Pexels"
    );
  });

  it("is required beside CC BY and CC BY-SA images only", () => {
    expect(needsVisibleCredit("CC-BY-2.0")).toBe(true);
    expect(needsVisibleCredit("CC-BY-SA-4.0")).toBe(true);
    expect(needsVisibleCredit("CC0-1.0")).toBe(false);
    expect(needsVisibleCredit("Pexels")).toBe(false);
    expect(needsVisibleCredit("Unsplash")).toBe(false);
  });
});
