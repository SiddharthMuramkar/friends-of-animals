import { describe, expect, it } from "vitest";

import {
  buildCompetitionReport,
  reportTable,
  type CompetitionReport,
  type ReportAgeGroup,
  type ReportColumn,
  type ReportCountRow,
  type ReportFeeRow,
  type ReportLabels,
  type ReportLine,
  type ReportMetric,
  type ReportRoute,
} from "./competition-report";

const JUNIOR = "01938a00-0000-7000-8000-0000000a9001";
const MIDDLE = "01938a00-0000-7000-8000-0000000a9002";
const SENIOR = "01938a00-0000-7000-8000-0000000a9003";

/** Listed out of order on purpose: the report sorts by position. */
const AGE_GROUPS: ReportAgeGroup[] = [
  { id: SENIOR, label: "Seniors 14 to 17", position: 3 },
  { id: JUNIOR, label: "Juniors 6 to 9", position: 1 },
  { id: MIDDLE, label: "Middle 10 to 13", position: 2 },
];

const JUNIOR_COLUMN: ReportColumn = {
  kind: "age_group",
  id: JUNIOR,
  label: "Juniors 6 to 9",
};
const MIDDLE_COLUMN: ReportColumn = {
  kind: "age_group",
  id: MIDDLE,
  label: "Middle 10 to 13",
};
const SENIOR_COLUMN: ReportColumn = {
  kind: "age_group",
  id: SENIOR,
  label: "Seniors 14 to 17",
};

/** Counts in metric order: registrations, entries, shortlisted, verified, certificates. */
function values(
  registrations: number,
  entries: number,
  shortlisted: number | null,
  verified: number,
  certificates: number
): Record<ReportMetric, number | null> {
  return { registrations, entries, shortlisted, verified, certificates };
}

function rows(
  metric: ReportMetric,
  route: ReportRoute,
  junior: number,
  middle: number,
  senior: number
): ReportCountRow[] {
  return [
    { metric, route, ageGroupId: JUNIOR, count: junior },
    { metric, route, ageGroupId: MIDDLE, count: middle },
    { metric, route, ageGroupId: SENIOR, count: senior },
  ];
}

/**
 * The fixture from the brief, by hand: 30 registrations (20 school route,
 * 10 individual), 24 entries, 9 shortlisted, 7 verified, 5 certificates.
 * The individual route has no verified or certificate rows for the middle
 * and senior groups, as GROUP BY leaves out empty groups.
 */
const FIXTURE_COUNTS: ReportCountRow[] = [
  ...rows("registrations", "institution", 8, 7, 5),
  ...rows("registrations", "individual", 4, 3, 3),
  ...rows("entries", "institution", 7, 6, 4),
  ...rows("entries", "individual", 3, 2, 2),
  ...rows("shortlisted", "institution", 4, 3, 2),
  ...rows("verified", "institution", 3, 2, 1),
  { metric: "verified", route: "individual", ageGroupId: JUNIOR, count: 1 },
  ...rows("certificates", "institution", 2, 1, 1),
  { metric: "certificates", route: "individual", ageGroupId: JUNIOR, count: 1 },
];

function inr(capturedMinor: bigint, refundedMinor: bigint) {
  return {
    currency: "INR" as const,
    capturedMinor,
    refundedMinor,
    netMinor: capturedMinor - refundedMinor,
  };
}

/** Rs 6,000 captured on the school route; Rs 2,500 captured and Rs 250 refunded on the individual route. */
const FIXTURE_FEES: ReportFeeRow[] = [
  {
    route: "institution",
    currency: "INR",
    capturedMinor: 400_000n,
    refundedMinor: 0n,
  },
  {
    route: "institution",
    currency: "INR",
    capturedMinor: 200_000n,
    refundedMinor: 0n,
  },
  {
    route: "individual",
    currency: "INR",
    capturedMinor: 250_000n,
    refundedMinor: 25_000n,
  },
];

function build(
  input: Partial<Parameters<typeof buildCompetitionReport>[0]> = {}
): CompetitionReport {
  return buildCompetitionReport({
    ageGroups: AGE_GROUPS,
    counts: FIXTURE_COUNTS,
    fees: FIXTURE_FEES,
    ...input,
  });
}

describe("buildCompetitionReport", () => {
  it("matches the hand-computed fixture in every cell and total", () => {
    const expected: ReportLine[] = [
      {
        kind: "cell",
        route: "institution",
        column: JUNIOR_COLUMN,
        values: values(8, 7, 4, 3, 2),
      },
      {
        kind: "cell",
        route: "institution",
        column: MIDDLE_COLUMN,
        values: values(7, 6, 3, 2, 1),
      },
      {
        kind: "cell",
        route: "institution",
        column: SENIOR_COLUMN,
        values: values(5, 4, 2, 1, 1),
      },
      {
        kind: "route_total",
        route: "institution",
        values: values(20, 17, 9, 6, 4),
      },
      {
        kind: "cell",
        route: "individual",
        column: JUNIOR_COLUMN,
        values: values(4, 3, null, 1, 1),
      },
      {
        kind: "cell",
        route: "individual",
        column: MIDDLE_COLUMN,
        values: values(3, 2, null, 0, 0),
      },
      {
        kind: "cell",
        route: "individual",
        column: SENIOR_COLUMN,
        values: values(3, 2, null, 0, 0),
      },
      {
        kind: "route_total",
        route: "individual",
        values: values(10, 7, null, 1, 1),
      },
      {
        kind: "age_group_total",
        column: JUNIOR_COLUMN,
        values: values(12, 10, 4, 4, 3),
      },
      {
        kind: "age_group_total",
        column: MIDDLE_COLUMN,
        values: values(10, 8, 3, 2, 1),
      },
      {
        kind: "age_group_total",
        column: SENIOR_COLUMN,
        values: values(8, 6, 2, 1, 1),
      },
      { kind: "total", values: values(30, 24, 9, 7, 5) },
    ];

    const report = build();

    expect(report.columns).toEqual([
      JUNIOR_COLUMN,
      MIDDLE_COLUMN,
      SENIOR_COLUMN,
    ]);
    expect(report.lines).toEqual(expected);
  });

  it("totals fees by route and overall, net of refunds, in paise", () => {
    expect(build().fees).toEqual({
      byRoute: {
        institution: inr(600_000n, 0n),
        individual: inr(250_000n, 25_000n),
      },
      total: inr(850_000n, 25_000n),
    });
  });

  it("zero-fills every route and age group when nothing is counted yet", () => {
    const report = build({ counts: [], fees: [] });

    expect(report.lines).toHaveLength(12);
    for (const line of report.lines) {
      const notApplicable =
        (line.kind === "cell" || line.kind === "route_total") &&
        line.route === "individual";
      expect(line.values).toEqual(values(0, 0, notApplicable ? null : 0, 0, 0));
    }
    expect(report.fees.total).toEqual(inr(0n, 0n));
    expect(report.fees.byRoute.individual).toEqual(inr(0n, 0n));
  });

  it("adds up rows that repeat a route, age group and metric", () => {
    const report = build({
      counts: [
        {
          metric: "entries",
          route: "institution",
          ageGroupId: JUNIOR,
          count: 2,
        },
        {
          metric: "entries",
          route: "institution",
          ageGroupId: JUNIOR,
          count: 3,
        },
      ],
    });

    expect(report.lines[0]).toEqual({
      kind: "cell",
      route: "institution",
      column: JUNIOR_COLUMN,
      values: values(0, 5, 0, 0, 0),
    });
  });

  it("adds a trailing no-age-group column only when something is counted there", () => {
    const withoutBucket = build({ counts: FIXTURE_COUNTS });
    expect(withoutBucket.columns.map((column) => column.kind)).not.toContain(
      "no_age_group"
    );

    const report = build({
      counts: [
        {
          metric: "registrations",
          route: "individual",
          ageGroupId: null,
          count: 2,
        },
      ],
    });

    expect(report.columns).toEqual([
      JUNIOR_COLUMN,
      MIDDLE_COLUMN,
      SENIOR_COLUMN,
      { kind: "no_age_group" },
    ]);
    expect(report.lines).toContainEqual({
      kind: "cell",
      route: "individual",
      column: { kind: "no_age_group" },
      values: values(2, 0, null, 0, 0),
    });
    expect(report.lines).toContainEqual({
      kind: "cell",
      route: "institution",
      column: { kind: "no_age_group" },
      values: values(0, 0, 0, 0, 0),
    });
    expect(report.lines.at(-1)).toEqual({
      kind: "total",
      values: values(2, 0, 0, 0, 0),
    });
  });

  it("keeps a zero count with no age group out of the columns", () => {
    const report = build({
      counts: [
        {
          metric: "entries",
          route: "institution",
          ageGroupId: null,
          count: 0,
        },
      ],
    });

    expect(report.columns).toHaveLength(3);
  });

  it("refuses a count for an age group the competition doesn't have", () => {
    expect(() =>
      build({
        counts: [
          {
            metric: "registrations",
            route: "institution",
            ageGroupId: "01938a00-0000-7000-8000-0000000b9999",
            count: 1,
          },
        ],
      })
    ).toThrow(RangeError);
  });

  it("refuses an age group listed twice", () => {
    expect(() =>
      build({ ageGroups: [...AGE_GROUPS, AGE_GROUPS[0]!], counts: [] })
    ).toThrow(RangeError);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses the count %s",
    (count) => {
      expect(() =>
        build({
          counts: [
            {
              metric: "entries",
              route: "institution",
              ageGroupId: JUNIOR,
              count,
            },
          ],
        })
      ).toThrow(RangeError);
    }
  );

  it("refuses shortlisted entries on the individual route, which has no school round", () => {
    expect(() =>
      build({
        counts: [
          {
            metric: "shortlisted",
            route: "individual",
            ageGroupId: JUNIOR,
            count: 1,
          },
        ],
      })
    ).toThrow(RangeError);
  });

  it("accepts a zero shortlisted count on the individual route and still shows it as not applicable", () => {
    const report = build({
      counts: [
        {
          metric: "shortlisted",
          route: "individual",
          ageGroupId: JUNIOR,
          count: 0,
        },
      ],
    });

    expect(report.lines[4]).toMatchObject({
      kind: "cell",
      route: "individual",
      values: { shortlisted: null },
    });
  });

  it("refuses a route or metric it doesn't know", () => {
    const unknownRoute = {
      metric: "entries",
      route: "walk_in",
      ageGroupId: JUNIOR,
      count: 1,
    } as unknown as ReportCountRow;
    const unknownMetric = {
      metric: "winners",
      route: "institution",
      ageGroupId: JUNIOR,
      count: 1,
    } as unknown as ReportCountRow;

    expect(() => build({ counts: [unknownRoute] })).toThrow(RangeError);
    expect(() => build({ counts: [unknownMetric] })).toThrow(RangeError);
  });

  it("refuses fees in another currency", () => {
    expect(() =>
      build({
        fees: [
          {
            route: "individual",
            currency: "USD",
            capturedMinor: 1_000n,
            refundedMinor: 0n,
          },
        ],
      })
    ).toThrow(RangeError);
  });

  it("refuses negative fee amounts", () => {
    expect(() =>
      build({
        fees: [
          {
            route: "individual",
            currency: "INR",
            capturedMinor: 1_000n,
            refundedMinor: -1n,
          },
        ],
      })
    ).toThrow(RangeError);
  });
});

const LABELS: ReportLabels = {
  routeHeader: "Route",
  ageGroupHeader: "Age group",
  metric: {
    registrations: "Registrations",
    entries: "Entries",
    shortlisted: "Shortlisted",
    verified: "Verified",
    certificates: "Certificates",
  },
  fees: {
    captured: "Fees captured",
    refunded: "Fees refunded",
    net: "Fees net",
  },
  route: { institution: "Through a school", individual: "Individual" },
  allRoutes: "All routes",
  allAgeGroups: "All age groups",
  noAgeGroup: "No age group",
};

describe("reportTable", () => {
  const table = reportTable(build(), LABELS);

  it("has one header cell per column: route, age group, five metrics, three fee columns", () => {
    expect(table.header).toEqual(
      [
        "Route",
        "Age group",
        "Registrations",
        "Entries",
        "Shortlisted",
        "Verified",
        "Certificates",
        "Fees captured",
        "Fees refunded",
        "Fees net",
      ].map((value) => ({ kind: "text", value }))
    );
  });

  it("has one row per report line, every row as wide as the header", () => {
    expect(table.rows).toHaveLength(build().lines.length);
    for (const row of table.rows) expect(row).toHaveLength(10);
  });

  it("writes a cell line with counts, not applicable cells and no fees", () => {
    expect(table.rows[4]).toEqual([
      { kind: "text", value: "Individual" },
      { kind: "text", value: "Juniors 6 to 9" },
      { kind: "count", value: 4 },
      { kind: "count", value: 3 },
      { kind: "not_applicable" },
      { kind: "count", value: 1 },
      { kind: "count", value: 1 },
      { kind: "empty" },
      { kind: "empty" },
      { kind: "empty" },
    ]);
  });

  it("writes a route's fees on its total line", () => {
    expect(table.rows[7]).toEqual([
      { kind: "text", value: "Individual" },
      { kind: "text", value: "All age groups" },
      { kind: "count", value: 10 },
      { kind: "count", value: 7 },
      { kind: "not_applicable" },
      { kind: "count", value: 1 },
      { kind: "count", value: 1 },
      { kind: "amount", minor: 250_000n, currency: "INR" },
      { kind: "amount", minor: 25_000n, currency: "INR" },
      { kind: "amount", minor: 225_000n, currency: "INR" },
    ]);
  });

  it("writes age-group totals without fees, which aren't split by age", () => {
    expect(table.rows[8]).toEqual([
      { kind: "text", value: "All routes" },
      { kind: "text", value: "Juniors 6 to 9" },
      { kind: "count", value: 12 },
      { kind: "count", value: 10 },
      { kind: "count", value: 4 },
      { kind: "count", value: 4 },
      { kind: "count", value: 3 },
      { kind: "empty" },
      { kind: "empty" },
      { kind: "empty" },
    ]);
  });

  it("ends with the grand total and the total fees", () => {
    expect(table.rows.at(-1)).toEqual([
      { kind: "text", value: "All routes" },
      { kind: "text", value: "All age groups" },
      { kind: "count", value: 30 },
      { kind: "count", value: 24 },
      { kind: "count", value: 9 },
      { kind: "count", value: 7 },
      { kind: "count", value: 5 },
      { kind: "amount", minor: 850_000n, currency: "INR" },
      { kind: "amount", minor: 25_000n, currency: "INR" },
      { kind: "amount", minor: 825_000n, currency: "INR" },
    ]);
  });

  it("labels the no-age-group column", () => {
    const withBucket = reportTable(
      build({
        counts: [
          {
            metric: "registrations",
            route: "individual",
            ageGroupId: null,
            count: 1,
          },
        ],
      }),
      LABELS
    );

    expect(withBucket.rows).toContainEqual(
      expect.arrayContaining([
        { kind: "text", value: "Individual" },
        { kind: "text", value: "No age group" },
      ])
    );
  });
});
