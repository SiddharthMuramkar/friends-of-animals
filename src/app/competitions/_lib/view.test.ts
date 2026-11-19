import { describe, expect, it } from "vitest";

import { SAMPLE_COMPETITIONS } from "@/content/sample";
import type { Competition } from "@/content/sample/model";

import {
  AGE_BANDS,
  competitionParams,
  filterTokens,
  fileRules,
  primaryAction,
  timeline,
} from "./view";

const open = SAMPLE_COMPETITIONS.find((c) => c.status === "REGISTRATION_OPEN")!;
const judging = SAMPLE_COMPETITIONS.find((c) => c.status === "FOA_JUDGING")!;

describe("filterTokens", () => {
  it("gives the status chip word, disciplines and overlapping age bands", () => {
    const t = filterTokens(open);
    expect(t.status).toBe("open");
    expect(t.disciplines).toBe("DRAWING PAINTING PHOTOGRAPHY");
    expect(t.ages).toBe("a5 a9 a13");
  });

  it("only lists bands an age group overlaps", () => {
    const teens: Competition = {
      ...open,
      ageGroups: [{ label: "Group C", minAge: 14, maxAge: 17 }],
    };
    expect(filterTokens(teens).ages).toBe("a13");
  });

  it("has one band key per AGE_BANDS entry", () => {
    expect(AGE_BANDS.map((b) => b.key)).toEqual(["a5", "a9", "a13", "a18"]);
  });
});

describe("primaryAction", () => {
  it("lets people register only while registration is open", () => {
    expect(primaryAction("REGISTRATION_OPEN")).toBe("register");
    expect(primaryAction("PUBLISHED")).toBe("opensSoon");
  });

  it("explains judging and results states", () => {
    expect(primaryAction("REGISTRATION_CLOSED")).toBe("underway");
    expect(primaryAction("FOA_JUDGING")).toBe("underway");
    expect(primaryAction("RESULTS_PUBLISHED")).toBe("results");
    expect(primaryAction("ARCHIVED")).toBe("results");
    expect(primaryAction("CANCELLED")).toBe("cancelled");
  });
});

describe("timeline", () => {
  it("lists every date in order, with the school shortlist last", () => {
    const steps = timeline(open);
    expect(steps.map((s) => s.kind)).toEqual([
      "registrationOpens",
      "registrationCloses",
      "confirmation",
      "making",
      "entriesClose",
      "shortlistCloses",
    ]);
    const making = steps.find((s) => s.kind === "making")!;
    expect(making.end).toBe(open.conductEndsAt);
  });

  it("marks steps that are already past", () => {
    const steps = timeline(judging, new Date("2026-11-18T00:00:00+05:30"));
    expect(steps.every((s) => s.past)).toBe(true);
    const ahead = timeline(open, new Date("2026-11-18T00:00:00+05:30"));
    expect(ahead.map((s) => s.past)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("marks a deadline done as soon as it passes", () => {
    const closes = Date.parse(open.registrationClosesAt);
    const kinds = (at: number) =>
      timeline(open, new Date(at))
        .filter((s) => s.past)
        .map((s) => s.kind);
    expect(kinds(closes - 1)).toEqual(["registrationOpens"]);
    expect(kinds(closes + 1)).toEqual([
      "registrationOpens",
      "registrationCloses",
    ]);
  });

  it("marks the making window done only once it has ended", () => {
    const making = (at: string) =>
      timeline(open, new Date(at)).find((s) => s.kind === "making")!.past;
    expect(making(open.conductStartsAt)).toBe(false);
    expect(making(open.conductEndsAt)).toBe(false);
    expect(making("2027-02-05T17:00:01+05:30")).toBe(true);
  });

  it("leaves out the shortlist step when schools don't take part", () => {
    const { shortlistSubmissionClosesAt: _, ...rest } = open;
    const solo = {
      ...rest,
      routes: open.routes.filter((r) => r.route === "INDIVIDUAL"),
    } as Competition;
    expect(timeline(solo).map((s) => s.kind)).not.toContain("shortlistCloses");
  });
});

describe("fileRules", () => {
  it("returns one row per discipline, in the competition's order", () => {
    expect(
      fileRules(["PHOTOGRAPHY", "DRAWING"]).map((r) => r.discipline)
    ).toEqual(["PHOTOGRAPHY", "DRAWING"]);
  });

  it("uses the default size and resolution limits", () => {
    const [essay, video] = fileRules(["ESSAY", "VIDEOGRAPHY"]);
    expect(essay.maxMb).toBe(10);
    expect(video.maxMb).toBe(500);
    expect(fileRules(["DRAWING"])[0].minPx).toBe(1200);
    expect(fileRules(["PHOTOGRAPHY"])[0].minPx).toBe(2000);
  });

  it("limits essays by length in words, not by pixel size", () => {
    const [essay] = fileRules(["ESSAY"]);
    expect(essay.maxWords).toBe(1000);
    expect(essay.minPx).toBeUndefined();
    expect(fileRules(["DRAWING"])[0].maxWords).toBeUndefined();
  });
});

describe("competitionParams", () => {
  it("lists every listed competition's slug", () => {
    expect(competitionParams(SAMPLE_COMPETITIONS)).toEqual(
      SAMPLE_COMPETITIONS.map((c) => ({ slug: c.slug }))
    );
  });

  it("falls back to one placeholder when there are none (production)", () => {
    expect(competitionParams([])).toEqual([{ slug: "__placeholder__" }]);
  });

  it("never lists drafts", () => {
    const draft = { ...open, slug: "draft-one", status: "DRAFT" } as const;
    expect(competitionParams([draft])).toEqual([{ slug: "__placeholder__" }]);
  });
});
