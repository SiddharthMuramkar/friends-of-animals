import { describe, expect, it } from "vitest";

import { SAMPLE_COMPETITIONS } from "@/content/sample";

import {
  ageRange,
  coverFor,
  fileRules,
  fromSample,
  nextKeyDate,
  primaryAction,
  timeline,
  type KeyDate,
} from "./model";

const open = SAMPLE_COMPETITIONS.find((c) => c.status === "REGISTRATION_OPEN")!;

describe("fromSample", () => {
  it("fills the card from a sample competition and marks it as sample", () => {
    const card = fromSample(open);
    expect(card).toEqual({
      slug: open.slug,
      name: open.name,
      theme: open.theme,
      status: "REGISTRATION_OPEN",
      sample: true,
      coverImageId: open.coverImageId,
      disciplines: open.disciplines,
      ageGroups: open.ageGroups,
      routes: open.routes.map((r) => ({ route: r.route, fee: r.feeBaseMinor })),
      keyDates: [
        { kind: "registrationOpens", at: open.registrationOpensAt },
        { kind: "registrationCloses", at: open.registrationClosesAt },
        { kind: "entriesClose", at: open.submissionClosesAt },
        { kind: "shortlistCloses", at: open.shortlistSubmissionClosesAt },
      ],
    });
  });

  it("leaves out the shortlist date when schools don't take part", () => {
    const { shortlistSubmissionClosesAt: _, ...rest } = open;
    const card = fromSample({
      ...rest,
      routes: open.routes.filter((r) => r.route === "INDIVIDUAL"),
    });
    expect(card.keyDates.map((d) => d.kind)).not.toContain("shortlistCloses");
  });
});

describe("nextKeyDate", () => {
  const dates: KeyDate[] = [
    { kind: "registrationOpens", at: "2026-12-01T03:30:00.000Z" },
    { kind: "registrationCloses", at: "2027-01-15T18:29:00.000Z" },
    { kind: "entriesClose", at: "2027-02-05T11:30:00.000Z" },
  ];

  it("is the first date after now", () => {
    expect(nextKeyDate(dates, new Date("2026-12-10T00:00:00Z"))).toEqual(
      dates[1]
    );
  });

  it("is null once every date has passed", () => {
    expect(nextKeyDate(dates, new Date("2027-03-01T00:00:00Z"))).toBeNull();
  });
});

describe("ageRange", () => {
  it("spans the youngest and the oldest group", () => {
    expect(
      ageRange([
        { label: "B", minAge: 9, maxAge: 12 },
        { label: "A", minAge: 5, maxAge: 8 },
      ])
    ).toEqual({ min: 5, max: 12 });
  });
});

describe("timeline", () => {
  const dates: KeyDate[] = [
    { kind: "registrationOpens", at: "2026-12-01T03:30:00.000Z" },
    { kind: "registrationCloses", at: "2027-01-15T18:29:00.000Z" },
  ];

  it("lists every date in order and marks the ones already past", () => {
    expect(timeline(dates, new Date("2026-12-10T00:00:00Z"))).toEqual([
      { ...dates[0], past: true },
      { ...dates[1], past: false },
    ]);
  });

  it("marks a deadline done only once it has passed", () => {
    const closes = Date.parse(dates[1].at);
    expect(timeline(dates, new Date(closes))[1].past).toBe(false);
    expect(timeline(dates, new Date(closes + 1))[1].past).toBe(true);
  });
});

describe("coverFor", () => {
  it("gives each discipline a fixed credited photo, by the first discipline", () => {
    expect(coverFor(["PHOTOGRAPHY", "DRAWING"])).toBe(
      coverFor(["PHOTOGRAPHY"])
    );
    expect(coverFor(["DRAWING"])).not.toBe(coverFor(["PHOTOGRAPHY"]));
  });

  it("has a photo for a competition with no disciplines yet (a preview)", () => {
    expect(coverFor([])).toBe(coverFor(["DRAWING"]));
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
