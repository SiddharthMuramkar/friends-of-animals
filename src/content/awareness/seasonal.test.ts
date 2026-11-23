import { describe, expect, it } from "vitest";

import { SITE_IMAGE_IDS } from "@/lib/images/credits";

import { QUOTE_IDS } from "../quotes";
import {
  SEASONAL_MONTHS,
  SEASONAL_SOURCES,
  seasonalGuideFor,
  seasonalMonthFor,
  seasonalMonthSchema,
} from "./seasonal";

describe("seasonalMonthFor (Asia/Kolkata)", () => {
  it("returns the IST month, not the UTC one", () => {
    // 31 Jan 19:00 UTC is 1 Feb 00:30 IST.
    expect(seasonalMonthFor(new Date("2026-01-31T19:00:00Z"))).toBe(2);
    expect(seasonalMonthFor(new Date("2026-01-31T18:29:59Z"))).toBe(1);
  });

  it("rolls December over to January at IST midnight", () => {
    expect(seasonalMonthFor(new Date("2026-12-31T18:29:59Z"))).toBe(12);
    expect(seasonalMonthFor(new Date("2026-12-31T18:30:00Z"))).toBe(1);
  });

  it("picks the matching guide entry", () => {
    expect(seasonalGuideFor(new Date("2026-11-18T06:00:00Z")).month).toBe(11);
  });
});

describe("SEASONAL_MONTHS", () => {
  it("has the twelve months in order", () => {
    expect(SEASONAL_MONTHS.map((m) => m.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("gives a month a photo or an illustration, never both", () => {
    const drawn = SEASONAL_MONTHS.find((m) => m.artId);
    const photo = SEASONAL_MONTHS.find((m) => m.imageId);
    expect(drawn && photo).toBeTruthy();
    expect(seasonalMonthSchema.safeParse(drawn).success).toBe(true);
    const both = { ...drawn, imageId: photo!.imageId };
    expect(seasonalMonthSchema.safeParse(both).success).toBe(false);
  });

  it("gives every month 2 to 4 actions and known sources", () => {
    for (const m of SEASONAL_MONTHS) {
      expect(m.actions.length, m.slug).toBeGreaterThanOrEqual(2);
      expect(m.actions.length, m.slug).toBeLessThanOrEqual(4);
      expect(m.sources.length, m.slug).toBeGreaterThan(0);
      for (const s of m.sources) expect(SEASONAL_SOURCES, s).toHaveProperty(s);
    }
  });

  it("uses only known images and quotes", () => {
    for (const m of SEASONAL_MONTHS) {
      if (m.imageId) expect(SITE_IMAGE_IDS).toContain(m.imageId);
      if (m.quoteId) expect(QUOTE_IDS).toContain(m.quoteId);
    }
  });

  it("keeps kid lines short: no sentence over 20 words", () => {
    for (const m of SEASONAL_MONTHS) {
      for (const line of [m.kid, ...m.actions]) {
        for (const sentence of line.split(/(?<=[.?])\s+/)) {
          expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(
            20
          );
        }
      }
    }
  });

  it("obeys the child-safety copy rules", () => {
    const kidText = SEASONAL_MONTHS.flatMap((m) => [m.kid, ...m.actions]);
    const all = SEASONAL_MONTHS.flatMap((m) => [
      m.kid,
      ...m.actions,
      m.grownUps,
      m.why,
    ]);
    for (const line of kidText) {
      expect(line).not.toMatch(
        /feed (the )?(street )?(dogs?|cats?|pigeons?|cows?)/i
      );
      expect(line).not.toMatch(/\b(pick (it )?up|pet the|stroke)\b/i);
    }
    for (const line of all) {
      expect(line).not.toMatch(/\bmilk\b|\bbread\b|\brotis?\b/i);
      expect(line).not.toMatch(/NGT banned glass/i);
    }
  });
});
