import { describe, expect, it } from "vitest";

import {
  ADOPTION_APPLICATION_ACTIONS,
  ADOPTION_APPLICATION_STATUSES,
  decideAdoptionApplicationTransition,
  isOpenAdoptionApplication,
  ownerSeesApplicantContact,
  type AdoptionApplicationAction,
  type AdoptionApplicationActor,
  type AdoptionApplicationStatus,
} from "./application-status";

// The whole table, written out from the ticket: [from, action, actor, to].
const ALLOWED: [
  AdoptionApplicationStatus,
  AdoptionApplicationAction,
  AdoptionApplicationActor,
  AdoptionApplicationStatus,
][] = [
  ["submitted", "start_review", "coordinator", "under_review"],
  ["under_review", "put_in_contact", "coordinator", "in_contact"],
  ["in_contact", "record_adopted", "coordinator", "adopted"],
  ["under_review", "record_not_matched", "coordinator", "not_matched"],
  ["in_contact", "record_not_matched", "coordinator", "not_matched"],
  ["submitted", "decline", "coordinator", "declined"],
  ["under_review", "decline", "coordinator", "declined"],
  ["in_contact", "decline", "coordinator", "declined"],
  ["submitted", "withdraw", "applicant", "withdrawn"],
  ["under_review", "withdraw", "applicant", "withdrawn"],
  ["in_contact", "withdraw", "applicant", "withdrawn"],
  ["submitted", "close_listing", "system", "listing_closed"],
  ["under_review", "close_listing", "system", "listing_closed"],
  ["in_contact", "close_listing", "system", "listing_closed"],
];

const ACTORS: AdoptionApplicationActor[] = [
  "coordinator",
  "applicant",
  "system",
];

const REASONED = new Set<AdoptionApplicationAction>([
  "record_not_matched",
  "decline",
]);

describe("the adoption application transition table", () => {
  for (const from of ADOPTION_APPLICATION_STATUSES) {
    for (const action of ADOPTION_APPLICATION_ACTIONS) {
      for (const actor of ACTORS) {
        const allowed = ALLOWED.find(
          ([f, a, by]) => f === from && a === action && by === actor
        );
        it(`${from} × ${action} by ${actor}: ${allowed ? allowed[3] : "refused"}`, () => {
          const decision = decideAdoptionApplicationTransition({
            from,
            action,
            actor,
            reason: REASONED.has(action) ? "Lives too far away" : null,
          });
          if (allowed) {
            expect(decision).toMatchObject({ ok: true, to: allowed[3] });
          } else {
            expect(decision.ok).toBe(false);
          }
        });
      }
    }
  }

  it("refuses the wrong actor before looking at the status", () => {
    expect(
      decideAdoptionApplicationTransition({
        from: "adopted",
        action: "start_review",
        actor: "applicant",
      })
    ).toEqual({ ok: false, reason: "forbidden_actor" });
    expect(
      decideAdoptionApplicationTransition({
        from: "submitted",
        action: "withdraw",
        actor: "coordinator",
      })
    ).toEqual({ ok: false, reason: "forbidden_actor" });
  });

  it("never reopens a closed application", () => {
    for (const from of [
      "adopted",
      "not_matched",
      "declined",
      "withdrawn",
      "listing_closed",
    ] as const) {
      expect(
        decideAdoptionApplicationTransition({
          from,
          action: "start_review",
          actor: "coordinator",
        })
      ).toEqual({ ok: false, reason: "invalid_transition" });
    }
  });

  it("needs a reason to record not matched or to decline, and keeps it trimmed", () => {
    for (const action of ["record_not_matched", "decline"] as const) {
      for (const reason of [undefined, null, "", "   "]) {
        expect(
          decideAdoptionApplicationTransition({
            from: "under_review",
            action,
            actor: "coordinator",
            reason,
          })
        ).toEqual({ ok: false, reason: "reason_required" });
      }
    }
    expect(
      decideAdoptionApplicationTransition({
        from: "under_review",
        action: "decline",
        actor: "coordinator",
        reason: "x".repeat(1001),
      })
    ).toEqual({ ok: false, reason: "reason_too_long" });
    expect(
      decideAdoptionApplicationTransition({
        from: "under_review",
        action: "decline",
        actor: "coordinator",
        reason: "  Already has three dogs  ",
      })
    ).toMatchObject({
      ok: true,
      to: "declined",
      reason: "Already has three dogs",
    });
  });

  it("drops a reason on moves that take none", () => {
    expect(
      decideAdoptionApplicationTransition({
        from: "submitted",
        action: "start_review",
        actor: "coordinator",
        reason: "ignored",
      })
    ).toEqual({
      ok: true,
      to: "under_review",
      reason: null,
      sharesContact: false,
      closesListing: false,
    });
  });

  it("shares the contact on put in contact, and closes the listing on adopted", () => {
    expect(
      decideAdoptionApplicationTransition({
        from: "under_review",
        action: "put_in_contact",
        actor: "coordinator",
      })
    ).toMatchObject({ sharesContact: true, closesListing: false });
    expect(
      decideAdoptionApplicationTransition({
        from: "in_contact",
        action: "record_adopted",
        actor: "coordinator",
      })
    ).toMatchObject({ sharesContact: false, closesListing: true });
  });
});

describe("open applications and contact visibility", () => {
  it("counts submitted, under review and in contact as open", () => {
    expect(
      ADOPTION_APPLICATION_STATUSES.filter(isOpenAdoptionApplication)
    ).toEqual(["submitted", "under_review", "in_contact"]);
  });

  it("shows the applicant's contact to the organisation only in contact or adopted", () => {
    expect(
      ADOPTION_APPLICATION_STATUSES.filter(ownerSeesApplicantContact)
    ).toEqual(["in_contact", "adopted"]);
  });
});
