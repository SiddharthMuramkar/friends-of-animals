import { describe, expect, it } from "vitest";

import {
  missingCertificates,
  planCertificates,
  type CompetitionFacts,
  type ExpectedCertificate,
  type FinalOutcome,
  type RegistrationFacts,
} from "./eligibility";

const FINAL_ROUND = "round-final";
const SCHOOL_ROUND = "round-school-a";

function registration(
  id: string,
  facts: Partial<RegistrationFacts> = {}
): RegistrationFacts {
  return {
    registrationId: id,
    participantProfileId: `profile-${id}`,
    route: "individual",
    standing: "confirmed",
    entryReachedSubmitted: true,
    schoolRound: null,
    ...facts,
  };
}

function schoolStudent(
  id: string,
  facts: Partial<RegistrationFacts> = {},
  round: Partial<NonNullable<RegistrationFacts["schoolRound"]>> = {}
): RegistrationFacts {
  return registration(id, {
    route: "institution",
    schoolRound: {
      roundId: SCHOOL_ROUND,
      decided: true,
      entryId: null,
      position: null,
      ...round,
    },
    ...facts,
  });
}

function outcome(
  registrationId: string,
  value: FinalOutcome["outcome"],
  awardPosition: number | null = null
): FinalOutcome {
  return {
    registrationId,
    entryId: `entry-${registrationId}`,
    outcome: value,
    awardPosition,
  };
}

/** The plan as `registration type round` lines, for readable tables. */
function lines(plan: readonly ExpectedCertificate[]): string[] {
  return plan.map(
    (certificate) =>
      `${certificate.registrationId} ${certificate.type} ${certificate.roundId ?? "-"}`
  );
}

const SHORTLIST_ONLY: CompetitionFacts = {
  submissionScope: "shortlist_only",
  finalRoundId: FINAL_ROUND,
};
const ALL_PARTICIPANTS: CompetitionFacts = {
  submissionScope: "all_participants",
  finalRoundId: FINAL_ROUND,
};

describe("planCertificates", () => {
  it("issues the expected set for a mixed competition", () => {
    // Two adult individuals, a minor individual and three school students
    // in a shortlist-only competition, one with no digital entry at all.
    const registrations = [
      registration("adult-1"),
      registration("adult-2"),
      registration("minor-1"),
      schoolStudent(
        "student-1",
        {},
        { entryId: "entry-student-1", position: 1 }
      ),
      schoolStudent(
        "student-2",
        {},
        { entryId: "entry-student-2", position: null }
      ),
      schoolStudent("student-3", { entryReachedSubmitted: false }),
    ];
    const outcomes = [
      outcome("adult-1", "winner", 1),
      outcome("minor-1", "runner_up", 2),
      outcome("student-1", "finalist"),
      outcome("adult-2", "none"),
    ];

    expect(
      lines(planCertificates(SHORTLIST_ONLY, registrations, outcomes))
    ).toEqual([
      "adult-1 participation -",
      "adult-1 winner round-final",
      "adult-2 participation -",
      "minor-1 participation -",
      "minor-1 runner_up round-final",
      "student-1 participation -",
      "student-1 school_merit round-school-a",
      "student-1 finalist round-final",
      "student-2 participation -",
      "student-3 participation -",
    ]);
  });

  it("carries the award position, entry and profile onto each certificate", () => {
    const plan = planCertificates(
      ALL_PARTICIPANTS,
      [
        schoolStudent("s", {}, { entryId: "entry-s", position: 2 }),
        registration("w"),
      ],
      [outcome("w", "winner", 1)]
    );

    expect(plan).toEqual([
      {
        registrationId: "s",
        participantProfileId: "profile-s",
        type: "participation",
        roundId: null,
        entryId: null,
        awardPosition: null,
      },
      {
        registrationId: "s",
        participantProfileId: "profile-s",
        type: "school_merit",
        roundId: SCHOOL_ROUND,
        entryId: "entry-s",
        awardPosition: 2,
      },
      {
        registrationId: "w",
        participantProfileId: "profile-w",
        type: "participation",
        roundId: null,
        entryId: null,
        awardPosition: null,
      },
      {
        registrationId: "w",
        participantProfileId: "profile-w",
        type: "winner",
        roundId: FINAL_ROUND,
        entryId: "entry-w",
        awardPosition: 1,
      },
    ]);
  });

  describe("participation", () => {
    it.each<[string, CompetitionFacts, RegistrationFacts, boolean]>([
      ["individual who submitted", ALL_PARTICIPANTS, registration("r"), true],
      [
        "individual whose entry never reached submitted",
        ALL_PARTICIPANTS,
        registration("r", { entryReachedSubmitted: false }),
        false,
      ],
      [
        "school student who submitted (all participants)",
        ALL_PARTICIPANTS,
        schoolStudent("r"),
        true,
      ],
      [
        "school student who never submitted (all participants)",
        ALL_PARTICIPANTS,
        schoolStudent("r", { entryReachedSubmitted: false }),
        false,
      ],
      [
        "school student without an entry in a decided round (shortlist only)",
        SHORTLIST_ONLY,
        schoolStudent("r", { entryReachedSubmitted: false }),
        true,
      ],
      [
        "school student whose round was never decided (shortlist only)",
        SHORTLIST_ONLY,
        schoolStudent(
          "r",
          { entryReachedSubmitted: false },
          { decided: false }
        ),
        false,
      ],
      [
        "school student with no school round (shortlist only)",
        SHORTLIST_ONLY,
        registration("r", {
          route: "institution",
          entryReachedSubmitted: false,
        }),
        false,
      ],
      [
        "individual in a shortlist-only competition (scope is for schools)",
        SHORTLIST_ONLY,
        registration("r", { entryReachedSubmitted: false }),
        false,
      ],
    ])("%s: %s", (_, competition, facts, expected) => {
      const types = planCertificates(competition, [facts], []).map(
        (certificate) => certificate.type
      );
      expect(types.includes("participation")).toBe(expected);
    });

    it.each(["withdrawn", "disqualified", "not_confirmed"] as const)(
      "gives a %s registration nothing at all, awards included",
      (standing) => {
        const plan = planCertificates(
          SHORTLIST_ONLY,
          [schoolStudent("r", { standing }, { position: 1 })],
          [outcome("r", "winner", 1)]
        );
        expect(plan).toEqual([]);
      }
    );

    it("counts an award as taking part, whatever the entry facts say", () => {
      const plan = planCertificates(
        ALL_PARTICIPANTS,
        [registration("r", { entryReachedSubmitted: false })],
        [outcome("r", "finalist")]
      );
      expect(lines(plan)).toEqual([
        "r participation -",
        "r finalist round-final",
      ]);
    });
  });

  describe("school merit", () => {
    it("goes only to positioned students of a decided school round", () => {
      const plan = planCertificates(
        ALL_PARTICIPANTS,
        [
          schoolStudent("first", {}, { position: 1 }),
          schoolStudent("shortlisted", {}, { position: null }),
          schoolStudent("undecided", {}, { position: 1, decided: false }),
        ],
        []
      );
      expect(lines(plan)).toEqual([
        "first participation -",
        "first school_merit round-school-a",
        "shortlisted participation -",
        "undecided participation -",
      ]);
    });
  });

  describe("final round awards", () => {
    it.each<[FinalOutcome["outcome"], string[]]>([
      ["winner", ["r participation -", "r winner round-final"]],
      ["runner_up", ["r participation -", "r runner_up round-final"]],
      ["finalist", ["r participation -", "r finalist round-final"]],
      // Default until FOA decides otherwise: no special-mention certificate.
      ["special_mention", ["r participation -"]],
      ["none", ["r participation -"]],
    ])("%s earns %j", (value, expected) => {
      const plan = planCertificates(
        ALL_PARTICIPANTS,
        [registration("r")],
        [outcome("r", value)]
      );
      expect(lines(plan)).toEqual(expected);
    });

    it("gives a registration only its best award when it has several", () => {
      const plan = planCertificates(
        ALL_PARTICIPANTS,
        [registration("r")],
        [outcome("r", "finalist"), outcome("r", "winner", 1)]
      );
      expect(lines(plan)).toEqual([
        "r participation -",
        "r winner round-final",
      ]);
    });

    it("refuses an award for a registration it wasn't told about", () => {
      expect(() =>
        planCertificates(ALL_PARTICIPANTS, [], [outcome("ghost", "winner", 1)])
      ).toThrow(RangeError);
    });

    it("refuses awards when the competition has no final round", () => {
      expect(() =>
        planCertificates(
          { submissionScope: "all_participants", finalRoundId: null },
          [registration("r")],
          [outcome("r", "winner", 1)]
        )
      ).toThrow(RangeError);
    });
  });

  it("refuses the same registration twice", () => {
    expect(() =>
      planCertificates(
        ALL_PARTICIPANTS,
        [registration("r"), registration("r")],
        []
      )
    ).toThrow(RangeError);
  });

  it("never plans a volunteer certificate", () => {
    const plan = planCertificates(
      ALL_PARTICIPANTS,
      [registration("a"), schoolStudent("b", {}, { position: 1 })],
      [outcome("a", "winner", 1)]
    );
    const types: string[] = plan.map((certificate) => certificate.type);
    expect(types).not.toContain("volunteer_service");
  });
});

describe("missingCertificates", () => {
  const plan = planCertificates(
    ALL_PARTICIPANTS,
    [registration("a"), schoolStudent("b", {}, { position: 1 })],
    [outcome("a", "winner", 1)]
  );

  it("returns everything when nothing was issued yet", () => {
    expect(missingCertificates(plan, [])).toEqual(plan);
  });

  it("returns nothing when the whole plan was issued already", () => {
    const issued = plan.map(({ registrationId, type, roundId }) => ({
      registrationId,
      type,
      roundId,
    }));
    expect(missingCertificates(plan, issued)).toEqual([]);
  });

  it("returns only what is missing, matching on registration, type and round", () => {
    const missing = missingCertificates(plan, [
      { registrationId: "a", type: "participation", roundId: null },
      // Same type and registration, another round: not the same certificate.
      { registrationId: "a", type: "winner", roundId: "round-earlier" },
      { registrationId: "b", type: "school_merit", roundId: SCHOOL_ROUND },
    ]);
    expect(lines(missing)).toEqual([
      "a winner round-final",
      "b participation -",
    ]);
  });

  it("ignores issued certificates that are not in the plan", () => {
    const missing = missingCertificates(plan, [
      { registrationId: "z", type: "participation", roundId: null },
    ]);
    expect(missing).toEqual(plan);
  });
});
