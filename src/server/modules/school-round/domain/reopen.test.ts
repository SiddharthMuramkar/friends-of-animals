import { describe, expect, it } from "vitest";

import { planReopen, type ReopenFacts } from "./reopen";

const DEADLINE = new Date("2027-03-01T18:29:59.000Z");
const BEFORE_DEADLINE = new Date("2027-02-27T04:30:00.000Z");

function facts(overrides: Partial<ReopenFacts> = {}): ReopenFacts {
  return {
    competitionInSchoolJudging: true,
    roundStatus: "finalised",
    shortlistDeadline: DEADLINE,
    now: BEFORE_DEADLINE,
    entries: [],
    ...overrides,
  };
}

describe("planReopen", () => {
  it("returns every shortlisted and not-shortlisted entry to where it was before finalising", () => {
    const plan = planReopen(
      facts({
        entries: [
          {
            entryId: "shortlisted",
            status: "submitted_to_foa",
            statusBefore: "submitted",
            hasLiveFile: true,
          },
          {
            entryId: "passed-over",
            status: "not_shortlisted",
            statusBefore: "submitted",
            hasLiveFile: true,
          },
          {
            entryId: "never-processed",
            status: "not_shortlisted",
            statusBefore: "failed",
            hasLiveFile: false,
          },
          {
            entryId: "infected",
            status: "not_shortlisted",
            statusBefore: "rejected",
            hasLiveFile: false,
          },
        ],
      })
    );

    expect(plan).toEqual({
      ok: true,
      roundStatus: "open",
      reverts: [
        { entryId: "shortlisted", from: "submitted_to_foa", to: "submitted" },
        { entryId: "passed-over", from: "not_shortlisted", to: "submitted" },
        { entryId: "never-processed", from: "not_shortlisted", to: "failed" },
        { entryId: "infected", from: "not_shortlisted", to: "rejected" },
      ],
    });
  });

  it("treats an entry whose file went live after finalising as submitted", () => {
    const plan = planReopen(
      facts({
        entries: [
          {
            entryId: "late-file",
            status: "not_shortlisted",
            statusBefore: "processing",
            hasLiveFile: true,
          },
          {
            entryId: "still-processing",
            status: "not_shortlisted",
            statusBefore: "processing",
            hasLiveFile: false,
          },
        ],
      })
    );

    expect(plan.ok && plan.reverts).toEqual([
      { entryId: "late-file", from: "not_shortlisted", to: "submitted" },
      {
        entryId: "still-processing",
        from: "not_shortlisted",
        to: "processing",
      },
    ]);
  });

  it("returns a promoted shortlist-only entry to shortlisted and leaves an unpromoted one alone", () => {
    const plan = planReopen(
      facts({
        entries: [
          {
            entryId: "promoted",
            status: "submitted_to_foa",
            statusBefore: "school_shortlisted",
            hasLiveFile: true,
          },
          {
            entryId: "waiting-for-file",
            status: "school_shortlisted",
            statusBefore: "school_shortlisted",
            hasLiveFile: false,
          },
        ],
      })
    );

    expect(plan.ok && plan.reverts).toEqual([
      {
        entryId: "promoted",
        from: "submitted_to_foa",
        to: "school_shortlisted",
      },
    ]);
  });

  it("reopens a round closed on the school's behalf", () => {
    const plan = planReopen(facts({ roundStatus: "closed_on_behalf" }));

    expect(plan).toEqual({ ok: true, roundStatus: "open", reverts: [] });
  });

  it("reopens as overdue once the shortlist deadline has passed", () => {
    expect(planReopen(facts({ now: DEADLINE }))).toMatchObject({
      ok: true,
      roundStatus: "overdue",
    });
    expect(
      planReopen(facts({ now: new Date(DEADLINE.getTime() - 1) }))
    ).toMatchObject({ ok: true, roundStatus: "open" });
  });

  it("reopens as open when the competition has no shortlist deadline", () => {
    expect(planReopen(facts({ shortlistDeadline: null }))).toMatchObject({
      ok: true,
      roundStatus: "open",
    });
  });

  it("refuses outside school judging", () => {
    expect(planReopen(facts({ competitionInSchoolJudging: false }))).toEqual({
      ok: false,
      blockers: [{ code: "competition_not_in_school_judging" }],
    });
  });

  it.each(["open", "overdue"] as const)(
    "refuses a round that is still %s",
    (roundStatus) => {
      expect(planReopen(facts({ roundStatus }))).toEqual({
        ok: false,
        blockers: [{ code: "round_not_finished" }],
      });
    }
  );

  it.each(["foa_verified", "sent_back"] as const)(
    "refuses while an entry of the round is %s",
    (status) => {
      const plan = planReopen(
        facts({
          entries: [
            {
              entryId: "fine",
              status: "submitted_to_foa",
              statusBefore: "submitted",
              hasLiveFile: true,
            },
            {
              entryId: "decided",
              status,
              statusBefore: "submitted",
              hasLiveFile: true,
            },
          ],
        })
      );

      expect(plan).toEqual({
        ok: false,
        blockers: [{ code: "entry_verified", entryId: "decided" }],
      });
    }
  );

  it("names every blocker at once", () => {
    const plan = planReopen(
      facts({
        competitionInSchoolJudging: false,
        roundStatus: "overdue",
        entries: [
          {
            entryId: "a",
            status: "foa_verified",
            statusBefore: "submitted",
            hasLiveFile: true,
          },
          {
            entryId: "b",
            status: "sent_back",
            statusBefore: "submitted",
            hasLiveFile: true,
          },
        ],
      })
    );

    expect(plan).toEqual({
      ok: false,
      blockers: [
        { code: "competition_not_in_school_judging" },
        { code: "round_not_finished" },
        { code: "entry_verified", entryId: "a" },
        { code: "entry_verified", entryId: "b" },
      ],
    });
  });

  it("refuses a recorded status that finalising can't have started from", () => {
    expect(() =>
      planReopen(
        facts({
          entries: [
            {
              entryId: "corrupt",
              status: "not_shortlisted",
              statusBefore: "submitted_to_foa",
              hasLiveFile: true,
            },
          ],
        })
      )
    ).toThrow(RangeError);
  });
});
