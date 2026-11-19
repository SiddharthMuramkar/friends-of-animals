import { describe, expect, it } from "vitest";

import { placeholder } from "@/lib/site";

import {
  SAMPLE_COMPETITIONS,
  SAMPLE_IMPACT,
  getSampleCertificate,
  getSampleCompetitions,
} from ".";
import { type Competition, competitionSchema } from "./model";
import {
  counterDisplay,
  feeDisplay,
  homeCompetitions,
  nextKeyDate,
  statusChip,
  visibleCounters,
} from "./selectors";

const base = SAMPLE_COMPETITIONS[0]!;
const make = (over: Partial<Competition>): Competition => ({
  ...base,
  ...over,
});

describe("sample competitions", () => {
  it("all pass the schema, date-order rules included", () => {
    for (const c of SAMPLE_COMPETITIONS) competitionSchema.parse(c);
  });

  it("cover open, upcoming and judging or results", () => {
    const statuses = SAMPLE_COMPETITIONS.map((c) => c.status);
    expect(statuses).toContain("REGISTRATION_OPEN");
    expect(statuses).toContain("PUBLISHED");
    expect(
      statuses.some((s) =>
        ["SCHOOL_JUDGING", "FOA_JUDGING", "RESULTS_PUBLISHED"].includes(s)
      )
    ).toBe(true);
  });

  it("rejects a competition whose registration closes after entries close", () => {
    const bad = make({ registrationClosesAt: "2027-03-01T23:59:00+05:30" });
    expect(competitionSchema.safeParse(bad).success).toBe(false);
  });

  it("requires a shortlist deadline only on the school route", () => {
    const noShortlist = make({ shortlistSubmissionClosesAt: undefined });
    expect(competitionSchema.safeParse(noShortlist).success).toBe(false);
  });

  it("are never served in production", () => {
    expect(getSampleCompetitions({ APP_ENV: "production" })).toEqual([]);
    expect(getSampleCompetitions({ APP_ENV: "staging" }).length).toBe(
      SAMPLE_COMPETITIONS.length
    );
  });
});

describe("getSampleCertificate", () => {
  it("is never served in production", () => {
    expect(getSampleCertificate({ APP_ENV: "production" })).toBeNull();
  });

  it("names a listed sample competition on test sites", () => {
    const cert = getSampleCertificate({ APP_ENV: "staging" });
    expect(cert?.competition.code).toBe(cert?.competitionCode);
    expect(SAMPLE_COMPETITIONS).toContain(cert?.competition);
  });
});

describe("homeCompetitions", () => {
  const list: Competition[] = [
    make({
      slug: "a",
      status: "PUBLISHED",
      registrationClosesAt: "2027-01-01T00:00:00+05:30",
    }),
    make({
      slug: "b",
      status: "REGISTRATION_OPEN",
      registrationClosesAt: "2027-02-01T00:00:00+05:30",
    }),
    make({ slug: "c", status: "DRAFT" }),
    make({
      slug: "d",
      status: "REGISTRATION_OPEN",
      registrationClosesAt: "2027-01-10T00:00:00+05:30",
    }),
    make({
      slug: "e",
      status: "IN_PROGRESS",
      registrationClosesAt: "2026-10-01T00:00:00+05:30",
    }),
    make({ slug: "f", status: "ARCHIVED" }),
    make({
      slug: "g",
      status: "REGISTRATION_CLOSED",
      registrationClosesAt: "2026-09-01T00:00:00+05:30",
    }),
  ];

  it("puts open registrations first, soonest closing first, max 3", () => {
    expect(homeCompetitions(list).map((c) => c.slug)).toEqual(["d", "b", "g"]);
  });

  it("never shows draft, archived or results", () => {
    const slugs = homeCompetitions(list, 10).map((c) => c.slug);
    expect(slugs).not.toContain("c");
    expect(slugs).not.toContain("f");
    expect(slugs).toEqual(["d", "b", "g", "e", "a"]);
  });
});

describe("statusChip", () => {
  it("maps statuses to one word each and hides drafts", () => {
    expect(statusChip("DRAFT")).toBeNull();
    expect(statusChip("PUBLISHED")?.label).toBe("upcoming");
    expect(statusChip("REGISTRATION_OPEN")?.label).toBe("open");
    for (const s of [
      "REGISTRATION_CLOSED",
      "IN_PROGRESS",
      "SCHOOL_JUDGING",
      "FOA_JUDGING",
      "RESULTS_PENDING_APPROVAL",
    ] as const)
      expect(statusChip(s)?.label).toBe("inProgress");
    expect(statusChip("RESULTS_PUBLISHED")?.label).toBe("results");
    expect(statusChip("ARCHIVED")?.label).toBe("results");
    expect(statusChip("CANCELLED")?.label).toBe("cancelled");
  });
});

describe("nextKeyDate", () => {
  const c = SAMPLE_COMPETITIONS.find((x) => x.status === "REGISTRATION_OPEN")!;
  it("returns the first date still ahead", () => {
    expect(nextKeyDate(c, new Date("2026-11-18T00:00:00Z"))).toEqual({
      kind: "registrationCloses",
      at: c.registrationClosesAt,
    });
    expect(nextKeyDate(c, new Date("2027-01-20T00:00:00Z"))?.kind).toBe(
      "entriesClose"
    );
  });
  it("moves on the moment a deadline passes", () => {
    const closes = Date.parse(c.registrationClosesAt);
    expect(nextKeyDate(c, new Date(closes - 1))?.kind).toBe(
      "registrationCloses"
    );
    expect(nextKeyDate(c, new Date(closes + 1))).toEqual({
      kind: "entriesClose",
      at: c.submissionClosesAt,
    });
  });
  it("returns null once every date has passed", () => {
    expect(nextKeyDate(c, new Date("2030-01-01T00:00:00Z"))).toBeNull();
  });
});

describe("counterDisplay", () => {
  it("suppresses counts under 10", () => {
    expect(counterDisplay(0)).toBeNull();
    expect(counterDisplay(9)).toBeNull();
  });
  it("floors to a multiple of 10 with Indian grouping and a plus", () => {
    expect(counterDisplay(10)).toBe("10+");
    expect(counterDisplay(1249)).toBe("1,240+");
    expect(counterDisplay(123_456)).toBe("1,23,450+");
  });
  it("drops suppressed counters from the list", () => {
    const shown = visibleCounters(SAMPLE_IMPACT.counters);
    expect(shown.every((c) => c.display !== null)).toBe(true);
    expect(shown.length).toBeLessThan(SAMPLE_IMPACT.counters.length);
  });
});

describe("feeDisplay", () => {
  it("shows Free for zero", () => {
    expect(feeDisplay(0)).toEqual({ kind: "free" });
  });
  it("shows rupees with Indian grouping and no paise", () => {
    expect(feeDisplay(150_000)).toEqual({ kind: "amount", text: "₹1,500" });
    expect(feeDisplay(12_345_600)).toEqual({
      kind: "amount",
      text: "₹1,23,456",
    });
  });
  it("passes a placeholder through", () => {
    expect(feeDisplay(placeholder("feeSchool"))).toEqual({
      kind: "placeholder",
      key: "feeSchool",
    });
  });
});
