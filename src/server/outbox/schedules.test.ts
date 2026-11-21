import { describe, expect, it } from "vitest";

import {
  SCHEDULES,
  scheduleProblems,
  type ScheduleDefinition,
} from "./schedules";

const run = async () => {};

function schedule(overrides: Partial<ScheduleDefinition> = {}) {
  return {
    name: "retention.purge_expired",
    cron: "30 2 * * *",
    tz: "Asia/Kolkata",
    run,
    ...overrides,
  } satisfies ScheduleDefinition;
}

describe("SCHEDULES", () => {
  it("is a registry the worker can load as it stands", () => {
    expect(scheduleProblems(SCHEDULES)).toEqual([]);
  });
});

describe("scheduleProblems", () => {
  it("accepts named schedules with a five-field cron", () => {
    expect(
      scheduleProblems([
        schedule(),
        schedule({ name: "reports.weekly", cron: "0 9 * * 1", tz: "UTC" }),
      ])
    ).toEqual([]);
  });

  it("names a schedule declared twice", () => {
    expect(scheduleProblems([schedule(), schedule()])).toEqual([
      "retention.purge_expired is declared more than once",
    ]);
  });

  it.each(["", "* * * *", "0 0 * * * *", "every day"])(
    "refuses the cron %j",
    (cron) => {
      expect(scheduleProblems([schedule({ cron })])).toEqual([
        `retention.purge_expired has a cron that isn't five fields: "${cron}"`,
      ]);
    }
  );

  it("refuses a name pg-boss can't use as a queue", () => {
    expect(scheduleProblems([schedule({ name: "Purge expired!" })])).toEqual([
      `"Purge expired!" is not a schedule name (lower case, digits, "_" and "." only)`,
    ]);
  });
});
