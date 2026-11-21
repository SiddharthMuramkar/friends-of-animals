import { describe, expect, it } from "vitest";

import {
  checkSchoolRoundsFinished,
  isSchoolRoundFinished,
  planRoundDeadlineJob,
  type DeadlineFacts,
} from "./deadline";

const DEADLINE = new Date("2027-03-01T18:29:59.000Z");

function facts(overrides: Partial<DeadlineFacts> = {}): DeadlineFacts {
  return {
    deadline: DEADLINE,
    inSchoolJudging: true,
    rounds: [
      { roundId: "open", status: "open" },
      { roundId: "overdue", status: "overdue" },
      { roundId: "finalised", status: "finalised" },
      { roundId: "closed", status: "closed_on_behalf" },
    ],
    ...overrides,
  };
}

describe("planRoundDeadlineJob", () => {
  it("marks only the rounds still open when the deadline arrives", () => {
    expect(
      planRoundDeadlineJob({ dueAt: DEADLINE }, facts(), DEADLINE)
    ).toEqual({
      kind: "mark_overdue",
      roundIds: ["open"],
    });
  });

  it("marks nothing when every round is already decided or overdue", () => {
    const plan = planRoundDeadlineJob(
      { dueAt: DEADLINE },
      facts({ rounds: [{ roundId: "finalised", status: "finalised" }] }),
      new Date(DEADLINE.getTime() + 60_000)
    );

    expect(plan).toEqual({ kind: "mark_overdue", roundIds: [] });
  });

  it("runs late jobs as usual", () => {
    const plan = planRoundDeadlineJob(
      { dueAt: DEADLINE },
      facts(),
      new Date("2027-03-09T00:00:00.000Z")
    );

    expect(plan).toEqual({ kind: "mark_overdue", roundIds: ["open"] });
  });

  it("puts a job that runs early off until its instant", () => {
    const plan = planRoundDeadlineJob(
      { dueAt: DEADLINE },
      facts(),
      new Date(DEADLINE.getTime() - 1)
    );

    expect(plan).toEqual({ kind: "early", dueAt: DEADLINE });
  });

  it("does nothing when the deadline has moved or gone since the job was scheduled", () => {
    const moved = new Date(DEADLINE.getTime() + 2 * 24 * 60 * 60 * 1000);

    expect(
      planRoundDeadlineJob(
        { dueAt: DEADLINE },
        facts({ deadline: moved }),
        moved
      )
    ).toEqual({ kind: "stale" });
    expect(
      planRoundDeadlineJob(
        { dueAt: DEADLINE },
        facts({ deadline: null }),
        DEADLINE
      )
    ).toEqual({ kind: "stale" });
  });

  it("does nothing once the competition has left school judging", () => {
    const plan = planRoundDeadlineJob(
      { dueAt: DEADLINE },
      facts({ inSchoolJudging: false }),
      DEADLINE
    );

    expect(plan).toEqual({ kind: "inactive" });
  });
});

describe("checkSchoolRoundsFinished", () => {
  it("passes when every confirmed school's round is finalised or closed on its behalf", () => {
    expect(
      checkSchoolRoundsFinished([
        { institutionRegistrationId: "a", roundStatus: "finalised" },
        { institutionRegistrationId: "b", roundStatus: "closed_on_behalf" },
      ])
    ).toEqual({ pass: true });
  });

  it("passes with no schools at all (an individuals-only competition)", () => {
    expect(checkSchoolRoundsFinished([])).toEqual({ pass: true });
  });

  it("fails while any round is open or overdue, counting each kind", () => {
    expect(
      checkSchoolRoundsFinished([
        { institutionRegistrationId: "a", roundStatus: "finalised" },
        { institutionRegistrationId: "b", roundStatus: "open" },
        { institutionRegistrationId: "c", roundStatus: "overdue" },
        { institutionRegistrationId: "d", roundStatus: "overdue" },
      ])
    ).toEqual({
      pass: false,
      reason: "school_rounds_unfinished",
      details: { missing: 0, open: 1, overdue: 2 },
    });
  });

  it("counts a confirmed school with no round yet as unfinished", () => {
    expect(
      checkSchoolRoundsFinished([
        { institutionRegistrationId: "a", roundStatus: "finalised" },
        { institutionRegistrationId: "not-opened", roundStatus: null },
      ])
    ).toEqual({
      pass: false,
      reason: "school_rounds_unfinished",
      details: { missing: 1, open: 0, overdue: 0 },
    });
  });
});

describe("isSchoolRoundFinished", () => {
  it.each([
    ["open", false],
    ["overdue", false],
    ["finalised", true],
    ["closed_on_behalf", true],
  ] as const)("%s -> %s", (status, finished) => {
    expect(isSchoolRoundFinished(status)).toBe(finished);
  });
});
