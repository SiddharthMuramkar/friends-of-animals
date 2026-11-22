import { describe, expect, it } from "vitest";

import {
  allowedDecisions,
  decideInstitutionStatus,
  INSTITUTION_DECISIONS,
  INSTITUTION_STATUSES,
} from "./status";

const REASON = "Checked the school's affiliation letter";

describe("institution status transitions", () => {
  // Every status against every decision: the moves not listed are refused.
  const allowed = {
    "pending_verification verify": { to: "verified", outcome: "verified" },
    "pending_verification reject": { to: "rejected", outcome: "rejected" },
    "verified suspend": { to: "suspended", outcome: "suspended" },
    "suspended verify": { to: "verified", outcome: "reinstated" },
  } as const;

  const table = INSTITUTION_STATUSES.flatMap((from) =>
    INSTITUTION_DECISIONS.map((decision) => ({ from, decision }))
  );

  it("covers four statuses and three decisions", () => {
    expect(INSTITUTION_STATUSES).toEqual([
      "pending_verification",
      "verified",
      "rejected",
      "suspended",
    ]);
    expect(INSTITUTION_DECISIONS).toEqual(["verify", "reject", "suspend"]);
    expect(table).toHaveLength(12);
  });

  it.each(table)("$from + $decision", ({ from, decision }) => {
    const expected = allowed[`${from} ${decision}` as keyof typeof allowed];
    const result = decideInstitutionStatus({ from, decision, reason: REASON });
    if (expected) {
      expect(result).toMatchObject({ ok: true, ...expected, reason: REASON });
    } else {
      expect(result).toEqual({ ok: false, error: "transition_not_allowed" });
    }
  });

  it("issues the Institution ID only on the first verification", () => {
    expect(
      decideInstitutionStatus({
        from: "pending_verification",
        decision: "verify",
        reason: REASON,
      })
    ).toMatchObject({ ok: true, issuesInstitutionCode: true });
    expect(
      decideInstitutionStatus({
        from: "suspended",
        decision: "verify",
        reason: REASON,
      })
    ).toMatchObject({ ok: true, issuesInstitutionCode: false });
    expect(
      decideInstitutionStatus({
        from: "pending_verification",
        decision: "reject",
        reason: REASON,
      })
    ).toMatchObject({ ok: true, issuesInstitutionCode: false });
  });
});

describe("the reason for a decision", () => {
  it("is required for every decision", () => {
    for (const reason of ["", "   ", "\n\t"]) {
      expect(
        decideInstitutionStatus({
          from: "pending_verification",
          decision: "reject",
          reason,
        })
      ).toEqual({ ok: false, error: "reason_required" });
    }
  });

  it("is stored trimmed", () => {
    expect(
      decideInstitutionStatus({
        from: "verified",
        decision: "suspend",
        reason: "  Fee dispute under review \n",
      })
    ).toMatchObject({ ok: true, reason: "Fee dispute under review" });
  });

  it("holds at most 1000 characters", () => {
    const decide = (reason: string) =>
      decideInstitutionStatus({
        from: "pending_verification",
        decision: "verify",
        reason,
      });
    expect(decide("x".repeat(1000))).toMatchObject({ ok: true });
    expect(decide("x".repeat(1001))).toEqual({
      ok: false,
      error: "reason_too_long",
    });
  });

  it("does not hide a refused move behind a missing reason", () => {
    expect(
      decideInstitutionStatus({
        from: "rejected",
        decision: "verify",
        reason: "",
      })
    ).toEqual({ ok: false, error: "transition_not_allowed" });
  });
});

describe("allowedDecisions", () => {
  it("offers staff exactly the decisions the table allows from each status", () => {
    expect(
      Object.fromEntries(
        INSTITUTION_STATUSES.map((status) => [status, allowedDecisions(status)])
      )
    ).toEqual({
      pending_verification: ["verify", "reject"],
      verified: ["suspend"],
      rejected: [],
      suspended: ["verify"],
    });
  });
});
