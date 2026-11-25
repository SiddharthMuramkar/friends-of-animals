import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type CompetitionView,
  DISCIPLINES,
  fromSample,
} from "@/components/competitions/model";
import { SAMPLE_COMPETITIONS } from "@/content/sample";

import {
  AGE_BANDS,
  competitionParams,
  filterTokens,
  isListedCompetitionSlug,
} from "./view";

const openCard = fromSample(
  SAMPLE_COMPETITIONS.find((c) => c.status === "REGISTRATION_OPEN")!
);
const open = {
  ...openCard,
  categories: openCard.disciplines.flatMap((discipline) =>
    openCard.ageGroups.map((g) => ({ discipline, ageGroup: g.label }))
  ),
};

describe("filterTokens", () => {
  it("gives the status chip word, disciplines and overlapping age bands", () => {
    const t = filterTokens(open);
    expect(t.status).toBe("open");
    expect(t.disciplines).toBe("DRAWING PAINTING PHOTOGRAPHY");
    expect(t.ages).toBe("a3 a9 a13");
    expect(t.pairs.split(" ")).toHaveLength(9);
  });

  it("only lists bands an age group overlaps", () => {
    const teens: Pick<CompetitionView, "status" | "ageGroups" | "categories"> =
      {
        ...open,
        ageGroups: [{ label: "Group C", minAge: 14, maxAge: 17 }],
        categories: [{ discipline: "DRAWING", ageGroup: "Group C" }],
      };
    expect(filterTokens(teens).ages).toBe("a13");
  });

  it("includes both ends of the supported ages and requires a real category", () => {
    const t = filterTokens({
      status: "REGISTRATION_OPEN",
      ageGroups: [
        { label: "Young", minAge: 3, maxAge: 4 },
        { label: "Not offered", minAge: 9, maxAge: 12 },
        { label: "Adults", minAge: 31, maxAge: 99 },
      ],
      categories: [
        { discipline: "DRAWING", ageGroup: " young " },
        { discipline: "PHOTOGRAPHY", ageGroup: "ADULTS" },
        { discipline: "ESSAY", ageGroup: "Unknown" },
      ],
    });
    expect(t.disciplines).toBe("DRAWING PHOTOGRAPHY");
    expect(t.ages).toBe("a3 a18");
    expect(t.pairs).toBe("DRAWING-a3 PHOTOGRAPHY-a18");
  });

  it("matches every age band overlapped by a category's group, without duplicates", () => {
    const t = filterTokens({
      status: "REGISTRATION_OPEN",
      ageGroups: [{ label: "Primary", minAge: 7, maxAge: 10 }],
      categories: [
        { discipline: "DRAWING", ageGroup: "Primary" },
        { discipline: "DRAWING", ageGroup: "Primary" },
      ],
    });
    expect(t.ages).toBe("a3 a9");
    expect(t.pairs).toBe("DRAWING-a3 DRAWING-a9");
  });

  it("files a published competition under upcoming", () => {
    expect(filterTokens({ ...open, status: "PUBLISHED" }).status).toBe(
      "upcoming"
    );
  });

  it("has one band key per AGE_BANDS entry", () => {
    expect(AGE_BANDS.map((b) => b.key)).toEqual(["a3", "a9", "a13", "a18"]);
  });

  it("has a CSS category selector for every discipline and age pair", () => {
    const css = readFileSync(
      path.join(import.meta.dirname, "../_components/filters.module.css"),
      "utf8"
    );
    for (const discipline of DISCIPLINES) {
      for (const { key } of AGE_BANDS) {
        expect(css).toContain(`[data-categories~="${discipline}-${key}"]`);
      }
    }
  });
});

describe("competitionParams", () => {
  it("prerenders only the placeholder: published slugs come from the database at request time", () => {
    expect(competitionParams()).toEqual([{ slug: "__placeholder__" }]);
  });
});

describe("the public competition pages", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const sources = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => ({ file: f, text: readFileSync(path.join(root, f), "utf8") }));

  it("read competitions from the database, never from the sample content", () => {
    expect(sources.map((s) => s.file)).toContain("page.tsx");
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/from\s+["']@\/content\/sample/);
      expect(text, file).not.toMatch(
        /getSampleCompetitions|SAMPLE_COMPETITIONS/
      );
    }
  });
});

describe("isListedCompetitionSlug", () => {
  /** A lookup over the published slugs that records what it was asked. */
  function lookupOf(published: string[]) {
    const asked: string[] = [];
    const lookup = async (slug: string) => {
      asked.push(slug);
      return published.includes(slug);
    };
    return { asked, lookup };
  }

  it("is true for a published slug and false for one that isn't", async () => {
    const { asked, lookup } = lookupOf(["kinder-skies"]);
    expect(await isListedCompetitionSlug("kinder-skies", lookup)).toBe(true);
    expect(await isListedCompetitionSlug("draft-one", lookup)).toBe(false);
    expect(asked).toEqual(["kinder-skies", "draft-one"]);
  });

  it("decodes the path segment before looking it up", async () => {
    const { asked, lookup } = lookupOf(["kinder-skies"]);
    expect(await isListedCompetitionSlug("kinder%2Dskies", lookup)).toBe(true);
    expect(asked).toEqual(["kinder-skies"]);
  });

  it("never asks about a malformed escape or a segment outside the slug pattern", async () => {
    const { asked, lookup } = lookupOf(["kinder-skies"]);
    for (const raw of [
      "%E0%A4%A",
      "%",
      "",
      "ab",
      "Kinder-Skies",
      "__placeholder__",
      "kinder%2Fskies",
      "kinder skies",
      "a".repeat(81),
    ]) {
      expect(await isListedCompetitionSlug(raw, lookup), raw).toBe(false);
    }
    expect(asked).toEqual([]);
  });
});
