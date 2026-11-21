import { describe, expect, it } from "vitest";

import { reportRetainedUntil } from "./retention";

const reportedAt = new Date("2027-01-15T04:30:00.000Z");

describe("reportRetainedUntil", () => {
  it("keeps an open report", () => {
    expect(
      reportRetainedUntil({ reportedAt, resolvedAt: null, subjectAge: 16 })
    ).toBeNull();
  });

  it("keeps a teenager's report 7 years after it was resolved", () => {
    // 16 at the report: 25 within 9 years; resolved 3 years on, plus 7 = 10.
    expect(
      reportRetainedUntil({
        reportedAt,
        resolvedAt: new Date("2030-01-15T04:30:00.000Z"),
        subjectAge: 16,
      })
    ).toEqual(new Date("2037-01-15T04:30:00.000Z"));
  });

  it("keeps a young child's report until they turn 25", () => {
    // 6 at the report: 25 within 19 years, later than resolution + 7.
    expect(
      reportRetainedUntil({
        reportedAt,
        resolvedAt: new Date("2027-03-01T00:00:00.000Z"),
        subjectAge: 6,
      })
    ).toEqual(new Date("2046-01-15T04:30:00.000Z"));
  });

  it("picks resolution + 7 when the two dates tie on the later one", () => {
    // 17 at the report: 25 within 8 years; resolved after 1 year, plus 7 = 8.
    expect(
      reportRetainedUntil({
        reportedAt,
        resolvedAt: new Date("2028-01-15T04:30:00.000Z"),
        subjectAge: 17,
      })
    ).toEqual(new Date("2035-01-15T04:30:00.000Z"));
  });

  it("assumes a newborn when the age is unknown, so nothing goes early", () => {
    expect(
      reportRetainedUntil({
        reportedAt,
        resolvedAt: new Date("2027-02-01T00:00:00.000Z"),
        subjectAge: null,
      })
    ).toEqual(new Date("2052-01-15T04:30:00.000Z"));
  });

  it("rolls 29 February to 1 March", () => {
    expect(
      reportRetainedUntil({
        reportedAt: new Date("2028-02-29T10:00:00.000Z"),
        resolvedAt: new Date("2028-02-29T10:00:00.000Z"),
        subjectAge: 17,
      })
    ).toEqual(new Date("2036-02-29T10:00:00.000Z"));
    expect(
      reportRetainedUntil({
        reportedAt: new Date("2020-01-01T00:00:00.000Z"),
        resolvedAt: new Date("2028-02-29T10:00:00.000Z"),
        subjectAge: 17,
      })
    ).toEqual(new Date("2035-03-01T10:00:00.000Z"));
  });
});
