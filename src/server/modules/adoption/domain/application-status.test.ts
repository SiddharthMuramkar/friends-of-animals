import { describe, expect, it } from "vitest";

import {
  ADOPTION_APPLICATION_STATUSES,
  type AdoptionApplicationStatus,
  type ApplicationAction,
  type ApplicationActor,
  decideApplicationTransition,
  isOpenApplication,
  ownerSeesApplicantContact,
  planListingClosure,
} from "./application-status";

const START_REVIEW: ApplicationAction = { kind: "start_review" };
const PUT_IN_CONTACT: ApplicationAction = { kind: "put_in_contact" };
const ADOPTED: ApplicationAction = {
  kind: "record_outcome",
  outcome: "adopted",
};
const NOT_MATCHED: ApplicationAction = {
  kind: "record_outcome",
  outcome: "not_matched",
  reason: "Needs a home without cats",
};
const DECLINED: ApplicationAction = {
  kind: "record_outcome",
  outcome: "declined",
  reason: "No one at home during the day",
};
const WITHDRAW: ApplicationAction = { kind: "withdraw" };
const CLOSE: ApplicationAction = {
  kind: "close_for_listing",
  cause: "adopted_elsewhere",
};

/** Each action with the one actor allowed to take it. */
const ACTIONS: readonly [string, ApplicationAction, ApplicationActor][] = [
  ["start_review", START_REVIEW, "coordinator"],
  ["put_in_contact", PUT_IN_CONTACT, "coordinator"],
  ["adopted", ADOPTED, "coordinator"],
  ["not_matched", NOT_MATCHED, "coordinator"],
  ["declined", DECLINED, "coordinator"],
  ["withdraw", WITHDRAW, "applicant"],
  ["close_for_listing", CLOSE, "system"],
];

// The table from the ticket: the coordinator moves an application through
// review, contact and outcome; the applicant may withdraw while it is open;
// the listing closing ends every open application. "—" is a forbidden move.
const TABLE: Record<
  AdoptionApplicationStatus,
  Record<string, AdoptionApplicationStatus | "—">
> = {
  submitted: {
    start_review: "under_review",
    put_in_contact: "—",
    adopted: "—",
    not_matched: "—",
    declined: "declined",
    withdraw: "withdrawn",
    close_for_listing: "listing_closed",
  },
  under_review: {
    start_review: "—",
    put_in_contact: "in_contact",
    adopted: "—",
    not_matched: "not_matched",
    declined: "declined",
    withdraw: "withdrawn",
    close_for_listing: "listing_closed",
  },
  in_contact: {
    start_review: "—",
    put_in_contact: "—",
    adopted: "adopted",
    not_matched: "not_matched",
    declined: "declined",
    withdraw: "withdrawn",
    close_for_listing: "listing_closed",
  },
  adopted: allForbidden(),
  not_matched: allForbidden(),
  declined: allForbidden(),
  withdrawn: allForbidden(),
  listing_closed: allForbidden(),
};

function allForbidden(): Record<string, "—"> {
  return Object.fromEntries(ACTIONS.map(([name]) => [name, "—"]));
}

describe("decideApplicationTransition", () => {
  it("covers every status in the table", () => {
    expect(Object.keys(TABLE).sort()).toEqual(
      [...ADOPTION_APPLICATION_STATUSES].sort()
    );
  });

  for (const from of ADOPTION_APPLICATION_STATUSES) {
    for (const [name, action, actor] of ACTIONS) {
      const expected = TABLE[from][name];
      it(`${from} + ${name} by the ${actor} → ${expected}`, () => {
        const decision = decideApplicationTransition({
          from,
          action,
          actor,
          sharingConsent: "given",
        });
        if (expected === "—") {
          expect(decision).toEqual({ ok: false, reason: "invalid_transition" });
        } else {
          expect(decision).toMatchObject({ ok: true, to: expected });
        }
      });
    }
  }

  it("lets only the allowed actor take each action, whatever the status", () => {
    const actors: ApplicationActor[] = ["coordinator", "applicant", "system"];
    for (const [, action, allowed] of ACTIONS) {
      for (const actor of actors.filter((other) => other !== allowed)) {
        expect(
          decideApplicationTransition({
            from: "in_contact",
            action,
            actor,
            sharingConsent: "given",
          })
        ).toEqual({ ok: false, reason: "forbidden_actor" });
      }
    }
  });

  it("refuses not matched and declined without a reason", () => {
    for (const outcome of ["not_matched", "declined"] as const) {
      for (const reason of [undefined, "", "   "]) {
        expect(
          decideApplicationTransition({
            from: "in_contact",
            action: { kind: "record_outcome", outcome, reason },
            actor: "coordinator",
            sharingConsent: "given",
          })
        ).toEqual({ ok: false, reason: "reason_required" });
      }
    }
  });

  it("refuses a reason longer than 1000 characters", () => {
    expect(
      decideApplicationTransition({
        from: "in_contact",
        action: {
          kind: "record_outcome",
          outcome: "declined",
          reason: "x".repeat(1001),
        },
        actor: "coordinator",
        sharingConsent: "given",
      })
    ).toEqual({ ok: false, reason: "reason_too_long" });
  });

  it("keeps the trimmed reason, and none for an outcome that needs none", () => {
    expect(
      decideApplicationTransition({
        from: "in_contact",
        action: {
          kind: "record_outcome",
          outcome: "declined",
          reason: "  Moving abroad  ",
        },
        actor: "coordinator",
        sharingConsent: "given",
      })
    ).toMatchObject({ ok: true, reason: "Moving abroad" });
    expect(
      decideApplicationTransition({
        from: "in_contact",
        action: ADOPTED,
        actor: "coordinator",
        sharingConsent: "given",
      })
    ).toMatchObject({ ok: true, reason: null });
  });

  it("records why the listing closed as the reason", () => {
    expect(
      decideApplicationTransition({
        from: "submitted",
        action: { kind: "close_for_listing", cause: "listing_withdrawn" },
        actor: "system",
        sharingConsent: "none",
      })
    ).toMatchObject({ ok: true, reason: "listing_withdrawn" });
  });

  it("puts the applicant in touch only while they agree to share their contact", () => {
    for (const sharingConsent of ["withdrawn", "none"] as const) {
      expect(
        decideApplicationTransition({
          from: "under_review",
          action: PUT_IN_CONTACT,
          actor: "coordinator",
          sharingConsent,
        })
      ).toEqual({ ok: false, reason: "sharing_consent_missing" });
    }
  });

  it("shares the contact on the contact step only", () => {
    const sharing = ACTIONS.filter(([name]) => {
      const from = name === "put_in_contact" ? "under_review" : "in_contact";
      const [, action, actor] = ACTIONS.find(([other]) => other === name)!;
      const decision = decideApplicationTransition({
        from,
        action,
        actor,
        sharingConsent: "given",
      });
      return decision.ok && decision.sharesContact;
    }).map(([name]) => name);
    expect(sharing).toEqual(["put_in_contact"]);
  });

  it("closes the listing and emits adoption.adopted only on adopted", () => {
    expect(
      decideApplicationTransition({
        from: "in_contact",
        action: ADOPTED,
        actor: "coordinator",
        sharingConsent: "given",
      })
    ).toMatchObject({
      ok: true,
      to: "adopted",
      closesListing: true,
      event: "adoption.adopted",
    });
    expect(
      decideApplicationTransition({
        from: "in_contact",
        action: DECLINED,
        actor: "coordinator",
        sharingConsent: "given",
      })
    ).toMatchObject({
      ok: true,
      closesListing: false,
      event: "adoption.application_status_changed",
    });
  });

  it("tells the applicant and the listing owner at each step, the applicant alone when the listing closes", () => {
    const steps: [
      AdoptionApplicationStatus,
      ApplicationAction,
      ApplicationActor,
    ][] = [
      ["submitted", START_REVIEW, "coordinator"],
      ["under_review", PUT_IN_CONTACT, "coordinator"],
      ["in_contact", ADOPTED, "coordinator"],
      ["in_contact", NOT_MATCHED, "coordinator"],
      ["submitted", DECLINED, "coordinator"],
      ["in_contact", WITHDRAW, "applicant"],
    ];
    for (const [from, action, actor] of steps) {
      expect(
        decideApplicationTransition({
          from,
          action,
          actor,
          sharingConsent: "given",
        })
      ).toMatchObject({ ok: true, notify: ["applicant", "listing_owner"] });
    }
    expect(
      decideApplicationTransition({
        from: "under_review",
        action: CLOSE,
        actor: "system",
        sharingConsent: "given",
      })
    ).toMatchObject({ ok: true, notify: ["applicant"] });
  });
});

describe("isOpenApplication", () => {
  it("counts submitted, under review and in contact as open", () => {
    expect(ADOPTION_APPLICATION_STATUSES.filter(isOpenApplication)).toEqual([
      "submitted",
      "under_review",
      "in_contact",
    ]);
  });
});

describe("ownerSeesApplicantContact", () => {
  it("shows the listing owner the applicant's contact only while in contact or adopted", () => {
    expect(
      ADOPTION_APPLICATION_STATUSES.filter(ownerSeesApplicantContact)
    ).toEqual(["in_contact", "adopted"]);
  });
});

describe("planListingClosure", () => {
  it("closes every other open application when one is adopted", () => {
    expect(
      planListingClosure({
        cause: "adopted_elsewhere",
        applications: [
          { id: "a-adopted", status: "adopted" },
          { id: "b", status: "submitted" },
          { id: "c", status: "in_contact" },
          { id: "d", status: "declined" },
          { id: "e", status: "withdrawn" },
          { id: "f", status: "under_review" },
        ],
      })
    ).toEqual([
      {
        id: "b",
        from: "submitted",
        to: "listing_closed",
        reason: "adopted_elsewhere",
      },
      {
        id: "c",
        from: "in_contact",
        to: "listing_closed",
        reason: "adopted_elsewhere",
      },
      {
        id: "f",
        from: "under_review",
        to: "listing_closed",
        reason: "adopted_elsewhere",
      },
    ]);
  });

  it("plans nothing when no application is open", () => {
    expect(
      planListingClosure({
        cause: "listing_withdrawn",
        applications: [{ id: "a", status: "not_matched" }],
      })
    ).toEqual([]);
  });
});
