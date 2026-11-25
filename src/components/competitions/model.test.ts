import { describe, expect, it } from "vitest";

import { SAMPLE_COMPETITIONS } from "@/content/sample";
import { placeholder } from "@/lib/site";
import type { PublicCompetition } from "@/server/modules/competitions";

import {
  ageRange,
  coverFor,
  fileRules,
  fromPublic,
  fromSample,
  liveRegistrationMode,
  nextKeyDate,
  paragraphs,
  primaryAction,
  statusChip,
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

describe("liveRegistrationMode", () => {
  const school = { route: "INSTITUTION", fee: 0 } as const;
  const individual = { route: "INDIVIDUAL", fee: 0 } as const;
  const realOpen = {
    status: "REGISTRATION_OPEN",
    sample: false,
    routes: [school, individual],
  } as const;

  it("only offers the participation routes actually open to visitors", () => {
    expect(liveRegistrationMode(realOpen)).toBe("both");
    expect(liveRegistrationMode({ ...realOpen, routes: [school] })).toBe(
      "school"
    );
    expect(liveRegistrationMode({ ...realOpen, routes: [individual] })).toBe(
      "individual"
    );
    expect(liveRegistrationMode({ ...realOpen, routes: [] })).toBeNull();
  });

  it("preserves sample and non-open competition states", () => {
    expect(liveRegistrationMode({ ...realOpen, sample: true })).toBeNull();
    for (const status of [
      "PUBLISHED",
      "REGISTRATION_CLOSED",
      "SCHOOL_JUDGING",
      "CANCELLED",
    ] as const) {
      expect(liveRegistrationMode({ ...realOpen, status })).toBeNull();
    }
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

describe("fromPublic", () => {
  const published: PublicCompetition = {
    id: "0190f5a2-0000-7000-8000-000000000001",
    code: "NEIGH27",
    slug: "neighbours-on-my-street",
    name: "Neighbours on My Street",
    theme: "Show one kind thing you do for an animal on your street.",
    welfareMessage: "Watch from a distance.\n\nTell a grown-up.",
    status: "published",
    participation: "both",
    disciplines: ["drawing", "photography"],
    ageGroups: [
      { label: "Group A", minAge: 5, maxAge: 8 },
      { label: "Group B", minAge: 9, maxAge: 12 },
    ],
    categories: [
      { discipline: "drawing", ageGroup: "Group A" },
      { discipline: "drawing", ageGroup: "Group B" },
      { discipline: "photography", ageGroup: "Group B" },
    ],
    ageCutoffDate: "2027-01-01",
    rules: "One entry per category.",
    permittedMaterials: "Pencils, crayons, a phone camera.",
    duration: "Two weeks",
    digitalScope: "all_participants",
    shortlistPerCategory: 5,
    schoolPositions: 3,
    physicalArtwork: { kind: "top_n", count: 2 },
    publicDisplay: true,
    auctionPermitted: false,
    keyDates: [
      { kind: "registration_opens", at: new Date("2026-12-01T03:30:00Z") },
      { kind: "registration_closes", at: new Date("2027-01-15T18:29:00Z") },
      { kind: "submissions_close", at: new Date("2027-02-05T11:30:00Z") },
      { kind: "school_round_closes", at: new Date("2027-02-20T11:30:00Z") },
    ],
    publishedAt: new Date("2026-11-21T04:30:00Z"),
  };

  it("maps a published competition onto the UI's words, with ISO dates", () => {
    const view = fromPublic(published);
    expect(view).toEqual({
      slug: "neighbours-on-my-street",
      name: "Neighbours on My Street",
      theme: published.theme,
      status: "PUBLISHED",
      sample: false,
      coverImageId: coverFor(["DRAWING"]),
      disciplines: ["DRAWING", "PHOTOGRAPHY"],
      ageGroups: published.ageGroups,
      routes: [
        { route: "INSTITUTION", fee: placeholder("feeSchool") },
        { route: "INDIVIDUAL", fee: placeholder("feeIndividual") },
      ],
      keyDates: [
        { kind: "registrationOpens", at: "2026-12-01T03:30:00.000Z" },
        { kind: "registrationCloses", at: "2027-01-15T18:29:00.000Z" },
        { kind: "entriesClose", at: "2027-02-05T11:30:00.000Z" },
        { kind: "shortlistCloses", at: "2027-02-20T11:30:00.000Z" },
      ],
      welfareMessage: published.welfareMessage,
      categories: [
        { discipline: "DRAWING", ageGroup: "Group A" },
        { discipline: "DRAWING", ageGroup: "Group B" },
        { discipline: "PHOTOGRAPHY", ageGroup: "Group B" },
      ],
      ageCutoffDate: "2027-01-01",
      rules: published.rules,
      permittedMaterials: published.permittedMaterials,
      duration: "Two weeks",
      digitalScope: "all_participants",
      shortlistPerCategory: 5,
      schoolPositions: 3,
      physicalArtwork: { kind: "top_n", count: 2 },
      publicDisplay: true,
      auctionPermitted: false,
      terms: null,
    });
  });

  it("carries the competition's terms, with each fee's paise as digits so it survives JSON", () => {
    const view = fromPublic({
      ...published,
      terms: {
        fees: [
          { route: "institution", kind: "amount", paise: 2147483649n },
          { route: "individual", kind: "free" },
        ],
        awards: [
          {
            roundKey: "foa_final",
            scheme: "medals_gsb",
            bands: [
              { band: "gold", prize: "A trophy" },
              { band: "silver", prize: null },
              { band: "bronze", prize: null },
            ],
          },
        ],
        documents: [
          {
            purpose: "competition_terms",
            title: "Competition terms",
            version: 2,
            href: "/documents/competition-terms/2",
          },
        ],
      },
    });

    expect(view.terms).toEqual({
      fees: [
        { route: "institution", kind: "amount", paise: "2147483649" },
        { route: "individual", kind: "free" },
      ],
      awards: [
        {
          roundKey: "foa_final",
          scheme: "medals_gsb",
          bands: [
            { band: "gold", prize: "A trophy" },
            { band: "silver", prize: null },
            { band: "bronze", prize: null },
          ],
        },
      ],
      documents: [
        {
          purpose: "competition_terms",
          title: "Competition terms",
          version: 2,
          href: "/documents/competition-terms/2",
        },
      ],
    });
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it("offers only the ways in the competition allows", () => {
    const routes = (participation: PublicCompetition["participation"]) =>
      fromPublic({ ...published, participation }).routes.map((r) => r.route);
    expect(routes("individuals")).toEqual(["INDIVIDUAL"]);
    expect(routes("institutions")).toEqual(["INSTITUTION"]);
    expect(routes("both")).toEqual(["INSTITUTION", "INDIVIDUAL"]);
  });

  it("survives JSON, as a cached read's result must", () => {
    const view = fromPublic(published);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it("fills the card fields the list's filters read", () => {
    const view = fromPublic(published);
    expect(
      nextKeyDate(view.keyDates, new Date("2026-12-10T00:00:00Z"))
    ).toEqual({ kind: "registrationCloses", at: "2027-01-15T18:29:00.000Z" });
    expect(ageRange(view.ageGroups)).toEqual({ min: 5, max: 12 });
  });

  it("keeps a cancelled competition listed, labelled cancelled, with nothing to register for (#80)", () => {
    const view = fromPublic({ ...published, status: "cancelled" });
    expect(view.status).toBe("CANCELLED");
    expect(statusChip(view.status)).toEqual({
      label: "cancelled",
      tone: "neutral",
    });
    expect(primaryAction(view.status)).toBe("cancelled");
  });
});

describe("paragraphs", () => {
  it("splits a manager's text into paragraphs at line breaks, dropping blank ones", () => {
    expect(
      paragraphs("Watch from a distance.\r\n\r\n  Tell a grown-up. \nBe kind.")
    ).toEqual(["Watch from a distance.", "Tell a grown-up.", "Be kind."]);
    expect(paragraphs("   ")).toEqual([]);
  });
});
