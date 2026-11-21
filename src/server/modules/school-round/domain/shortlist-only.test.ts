import { describe, expect, it } from "vitest";

import {
  checkShortlistOnlyDeclarations,
  digitalSubmissionPath,
  planShortlistOnlyOutcomes,
  SHORTLIST_ONLY_DECLARATIONS,
  shortlistOnlyReadiness,
} from "./shortlist-only";

describe("digitalSubmissionPath", () => {
  const editable = { editable: true };
  const closed = { editable: false };

  it.each([
    // Individuals always submit digitally, whatever the scope.
    ["all_participants", "individual", true, null, "upload"],
    ["all_participants", "individual", false, null, "submission_closed"],
    ["shortlist_only", "individual", true, null, "upload"],
    ["shortlist_only", "individual", false, null, "submission_closed"],
    ["shortlist_only", "individual", false, editable, "submission_closed"],
    // The school route under all participants uses the submission window
    // and nothing else; an open school round doesn't reopen uploads.
    ["all_participants", "institution", true, null, "upload"],
    ["all_participants", "institution", false, null, "submission_closed"],
    ["all_participants", "institution", false, editable, "submission_closed"],
    // Shortlist only: nothing before the school round, even while the
    // window is open; then the coordinator creates shortlisted entries.
    ["shortlist_only", "institution", true, null, "submission_not_open"],
    ["shortlist_only", "institution", false, null, "submission_not_open"],
    ["shortlist_only", "institution", false, editable, "shortlisted_entry"],
    ["shortlist_only", "institution", true, editable, "shortlisted_entry"],
    ["shortlist_only", "institution", false, closed, "round_not_editable"],
  ] as const)(
    "%s, %s route, window open %s, round %o -> %s",
    (scope, route, windowOpen, schoolRound, expected) => {
      const result = digitalSubmissionPath({
        scope,
        route,
        windowOpen,
        schoolRound,
      });
      expect(result.ok ? result.path : result.reason).toBe(expected);
    }
  );
});

describe("checkShortlistOnlyDeclarations", () => {
  it("lists the declarations a coordinator makes for every created entry", () => {
    expect([...SHORTLIST_ONLY_DECLARATIONS]).toEqual([
      "original_work",
      "faithful_reproduction",
      "participation_covered",
      "physical_work_kept",
    ]);
  });

  it("accepts every declaration, in any order, and returns them in order", () => {
    expect(
      checkShortlistOnlyDeclarations([
        "physical_work_kept",
        "original_work",
        "participation_covered",
        "faithful_reproduction",
      ])
    ).toEqual({ ok: true, declarations: [...SHORTLIST_ONLY_DECLARATIONS] });
  });

  it("counts a repeated declaration once", () => {
    expect(
      checkShortlistOnlyDeclarations([
        ...SHORTLIST_ONLY_DECLARATIONS,
        "original_work",
      ])
    ).toEqual({ ok: true, declarations: [...SHORTLIST_ONLY_DECLARATIONS] });
  });

  it("names every missing declaration", () => {
    expect(
      checkShortlistOnlyDeclarations(["original_work", "physical_work_kept"])
    ).toEqual({
      ok: false,
      missing: ["faithful_reproduction", "participation_covered"],
      unknown: [],
    });
  });

  it("refuses an empty set with every declaration missing", () => {
    expect(checkShortlistOnlyDeclarations([])).toEqual({
      ok: false,
      missing: [...SHORTLIST_ONLY_DECLARATIONS],
      unknown: [],
    });
  });

  it("names a declaration it doesn't know, even when the rest are made", () => {
    expect(
      checkShortlistOnlyDeclarations([
        ...SHORTLIST_ONLY_DECLARATIONS,
        "public_gallery",
      ])
    ).toEqual({ ok: false, missing: [], unknown: ["public_gallery"] });
  });
});

describe("shortlistOnlyReadiness", () => {
  const shortlisted = {
    scope: "shortlist_only",
    status: "school_shortlisted",
  } as const;

  it("promotes once the file is live and the round is finished", () => {
    expect(
      shortlistOnlyReadiness({
        ...shortlisted,
        fileLive: true,
        roundFinished: true,
      })
    ).toEqual({ kind: "promote" });
  });

  it.each([
    [true, false, ["finalise"]],
    [false, true, ["upload"]],
    [false, false, ["upload", "finalise"]],
  ] as const)(
    "file live %s, round finished %s: waits for %o",
    (fileLive, roundFinished, waitingFor) => {
      expect(
        shortlistOnlyReadiness({ ...shortlisted, fileLive, roundFinished })
      ).toEqual({ kind: "waiting", for: waitingFor });
    }
  );

  it.each([
    "processing",
    "submitted",
    "not_shortlisted",
    "submitted_to_foa",
    "foa_verified",
    "sent_back",
  ])(
    "does nothing for an entry that is %s, so a second trigger is harmless",
    (status) => {
      expect(
        shortlistOnlyReadiness({
          scope: "shortlist_only",
          status,
          fileLive: true,
          roundFinished: true,
        })
      ).toEqual({ kind: "no_action" });
    }
  );

  it("leaves all-participants entries to finalising", () => {
    expect(
      shortlistOnlyReadiness({
        scope: "all_participants",
        status: "school_shortlisted",
        fileLive: true,
        roundFinished: true,
      })
    ).toEqual({ kind: "no_action" });
  });
});

describe("planShortlistOnlyOutcomes", () => {
  const enrolments = [
    { registrationId: "reg-a", confirmed: true },
    { registrationId: "reg-b", confirmed: true },
    { registrationId: "reg-c", confirmed: true },
    { registrationId: "reg-d", confirmed: false },
  ];

  it("promotes live entries, keeps the rest shortlisted, and tells the others", () => {
    expect(
      planShortlistOnlyOutcomes({
        enrolments,
        entries: [
          {
            entryId: "entry-a",
            registrationId: "reg-a",
            fileLive: true,
            position: 1,
          },
          {
            entryId: "entry-b",
            registrationId: "reg-b",
            fileLive: false,
            position: null,
          },
        ],
      })
    ).toEqual({
      ok: true,
      outcomes: [
        {
          entryId: "entry-a",
          registrationId: "reg-a",
          outcome: "shortlisted",
          position: 1,
          statuses: ["submitted_to_foa"],
        },
        {
          entryId: "entry-b",
          registrationId: "reg-b",
          outcome: "shortlisted",
          position: null,
          statuses: [],
        },
      ],
      // reg-d never confirmed, so it isn't in the competition to be told.
      notShortlisted: ["reg-c"],
    });
  });

  it("tells every confirmed student when the school shortlisted nobody", () => {
    expect(planShortlistOnlyOutcomes({ enrolments, entries: [] })).toEqual({
      ok: true,
      outcomes: [],
      notShortlisted: ["reg-a", "reg-b", "reg-c"],
    });
  });

  it("tells each registration once, however often it is listed", () => {
    const plan = planShortlistOnlyOutcomes({
      enrolments: [...enrolments, { registrationId: "reg-c", confirmed: true }],
      entries: [],
    });
    expect(plan.ok && plan.notShortlisted).toEqual(["reg-a", "reg-b", "reg-c"]);
  });

  it("reports every entry that isn't for a confirmed student of the round", () => {
    expect(
      planShortlistOnlyOutcomes({
        enrolments,
        entries: [
          {
            entryId: "entry-x",
            registrationId: "reg-x",
            fileLive: true,
            position: null,
          },
          {
            entryId: "entry-d",
            registrationId: "reg-d",
            fileLive: true,
            position: null,
          },
        ],
      })
    ).toEqual({
      ok: false,
      blockers: [
        { code: "entry_not_in_round", entryId: "entry-x" },
        { code: "entry_not_in_round", entryId: "entry-d" },
      ],
    });
  });

  it("reports a second entry for one registration", () => {
    expect(
      planShortlistOnlyOutcomes({
        enrolments,
        entries: [
          {
            entryId: "entry-a",
            registrationId: "reg-a",
            fileLive: true,
            position: null,
          },
          {
            entryId: "entry-a2",
            registrationId: "reg-a",
            fileLive: false,
            position: null,
          },
        ],
      })
    ).toEqual({
      ok: false,
      blockers: [
        {
          code: "second_entry_for_registration",
          entryId: "entry-a2",
          registrationId: "reg-a",
        },
      ],
    });
  });
});
