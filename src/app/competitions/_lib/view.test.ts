import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type CompetitionCardModel,
  fromSample,
} from "@/components/competitions/model";
import { SAMPLE_COMPETITIONS } from "@/content/sample";

import {
  AGE_BANDS,
  competitionParams,
  filterTokens,
  isListedCompetitionSlug,
} from "./view";

const open = fromSample(
  SAMPLE_COMPETITIONS.find((c) => c.status === "REGISTRATION_OPEN")!
);

describe("filterTokens", () => {
  it("gives the status chip word, disciplines and overlapping age bands", () => {
    const t = filterTokens(open);
    expect(t.status).toBe("open");
    expect(t.disciplines).toBe("DRAWING PAINTING PHOTOGRAPHY");
    expect(t.ages).toBe("a5 a9 a13");
  });

  it("only lists bands an age group overlaps", () => {
    const teens: CompetitionCardModel = {
      ...open,
      ageGroups: [{ label: "Group C", minAge: 14, maxAge: 17 }],
    };
    expect(filterTokens(teens).ages).toBe("a13");
  });

  it("files a published competition under upcoming", () => {
    expect(filterTokens({ ...open, status: "PUBLISHED" }).status).toBe(
      "upcoming"
    );
  });

  it("has one band key per AGE_BANDS entry", () => {
    expect(AGE_BANDS.map((b) => b.key)).toEqual(["a5", "a9", "a13", "a18"]);
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
