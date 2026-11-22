import { describe, expect, it } from "vitest";

import {
  decideGuardianRequest,
  decideGuardianRequestAcceptance,
} from "./guardian-request";

const now = new Date("2026-11-21T10:00:00Z");
const teenEmail = { channel: "email", address: "teen2@example.test" } as const;
const mother = { channel: "email", address: "mother@example.test" } as const;
const member = { isAGuardian: false, holdsOtherRole: false };

describe("decideGuardianRequest", () => {
  it("sends a request to the guardian a teen names, open for 7 days", () => {
    expect(
      decideGuardianRequest({
        requester: member,
        guardianContact: mother,
        ownContacts: [teenEmail],
        pending: null,
        now,
      })
    ).toEqual({
      ok: true,
      action: "send",
      expiresAt: new Date("2026-11-28T10:00:00Z"),
    });
  });

  it("refuses a teen naming their own email address as the guardian's", () => {
    expect(
      decideGuardianRequest({
        requester: member,
        guardianContact: teenEmail,
        ownContacts: [teenEmail],
        pending: null,
        now,
      })
    ).toEqual({ ok: false, reason: "guardian_contact_is_self" });
  });

  it.each([
    ["has declared as a guardian", { ...member, isAGuardian: true }],
    [
      "holds a staff, school or judge role",
      { ...member, holdsOtherRole: true },
    ],
  ])(
    "refuses an account that %s before anything else, as a child's login can't",
    (_, requester) => {
      for (const pending of [
        null,
        { sameContact: true, expiresAt: new Date("2026-11-25T10:00:00Z") },
      ]) {
        expect(
          decideGuardianRequest({
            requester,
            guardianContact: pending ? null : teenEmail,
            ownContacts: [teenEmail],
            pending,
            now,
          })
        ).toEqual({ ok: false, reason: "requester_has_role" });
      }
    }
  );

  it("asks for the guardian's details when a teen with no guardian names nobody", () => {
    expect(
      decideGuardianRequest({
        requester: member,
        guardianContact: null,
        ownContacts: [teenEmail],
        pending: null,
        now,
      })
    ).toEqual({ ok: false, reason: "guardian_details_required" });
  });

  it("sends nothing new when the same guardian was asked and the link still works", () => {
    expect(
      decideGuardianRequest({
        requester: member,
        guardianContact: mother,
        ownContacts: [teenEmail],
        pending: {
          sameContact: true,
          expiresAt: new Date("2026-11-25T10:00:00Z"),
        },
        now,
      })
    ).toEqual({ ok: true, action: "reuse" });
  });

  it("replaces the pending request when the teen names someone else, or its link has expired", () => {
    const later = new Date("2026-11-25T10:00:00Z");
    for (const pending of [
      { sameContact: false, expiresAt: later },
      { sameContact: true, expiresAt: now },
    ]) {
      expect(
        decideGuardianRequest({
          requester: member,
          guardianContact: mother,
          ownContacts: [teenEmail],
          pending,
          now,
        })
      ).toEqual({
        ok: true,
        action: "replace",
        expiresAt: new Date("2026-11-28T10:00:00Z"),
      });
    }
  });

  it("needs no details again while the guardian already asked can still answer", () => {
    const base = {
      requester: member,
      guardianContact: null,
      ownContacts: [teenEmail],
      now,
    };
    expect(
      decideGuardianRequest({
        ...base,
        pending: {
          sameContact: false,
          expiresAt: new Date("2026-11-25T10:00:00Z"),
        },
      })
    ).toEqual({ ok: true, action: "reuse" });
    expect(
      decideGuardianRequest({
        ...base,
        pending: { sameContact: false, expiresAt: now },
      })
    ).toEqual({ ok: false, reason: "guardian_details_required" });
  });
});

describe("decideGuardianRequestAcceptance", () => {
  const live = {
    status: "pending",
    expiresAt: new Date("2026-11-28T10:00:00Z"),
  } as const;
  const mother = {
    isTheRequester: false,
    isTheRequestedContact: true,
    guardianVerified: true,
    ownProfile: "none" as "none" | "adult" | "minor",
  };
  const teen = {
    ...member,
    linkedElsewhere: false,
    isAdult: false,
  };
  const accept = (
    change: Partial<Parameters<typeof decideGuardianRequestAcceptance>[0]>
  ) =>
    decideGuardianRequestAcceptance({
      request: live,
      now,
      accepter: mother,
      childAlreadyAdded: false,
      requester: teen,
      ...change,
    });

  it("lets the verified guardian signed in with the requested address accept", () => {
    expect(accept({})).toEqual({ ok: true });
  });

  it.each([
    ["no request has the token", { request: null }, "not_found"],
    [
      "the request was accepted",
      { request: { ...live, status: "accepted" as const } },
      "already_used",
    ],
    [
      "the request was withdrawn",
      { request: { ...live, status: "revoked" as const } },
      "withdrawn",
    ],
    [
      "the link has expired",
      { request: { ...live, expiresAt: now } },
      "expired",
    ],
    [
      "the teen opens their own request",
      {
        accepter: {
          ...mother,
          isTheRequester: true,
          isTheRequestedContact: false,
        },
      },
      "requester_cannot_accept",
    ],
    [
      "someone signed in with another address",
      { accepter: { ...mother, isTheRequestedContact: false } },
      "contact_mismatch",
    ],
    [
      "the account asked registered itself as under 18",
      { accepter: { ...mother, ownProfile: "minor" as const } },
      "accepter_is_minor",
    ],
    [
      "the guardian has not verified yet",
      { accepter: { ...mother, guardianVerified: false } },
      "guardian_not_verified",
    ],
    [
      "the guardian already added the same child",
      { childAlreadyAdded: true },
      "child_already_added",
    ],
    [
      "the teen's login is already linked to another profile",
      { requester: { ...teen, linkedElsewhere: true } },
      "already_linked",
    ],
    [
      "the teen has turned 18 since asking",
      { requester: { ...teen, isAdult: true } },
      "requester_is_adult",
    ],
    [
      "the teen has declared as a guardian since asking",
      { requester: { ...teen, isAGuardian: true } },
      "requester_has_role",
    ],
    [
      "the teen's account holds a staff, school or judge role",
      { requester: { ...teen, holdsOtherRole: true } },
      "requester_has_role",
    ],
  ])("refuses when %s", (_, change, reason) => {
    expect(accept(change)).toEqual({ ok: false, reason });
  });

  it("lets a guardian who registered themselves as an adult accept", () => {
    expect(
      accept({ accepter: { ...mother, ownProfile: "adult" as const } })
    ).toEqual({ ok: true });
  });

  it("tells a minor they can't accept, not to verify, once they're the one asked", () => {
    const minor = { ...mother, ownProfile: "minor" as const };
    expect(accept({ accepter: { ...minor, guardianVerified: false } })).toEqual(
      { ok: false, reason: "accepter_is_minor" }
    );
    expect(
      accept({ accepter: { ...minor, isTheRequestedContact: false } })
    ).toEqual({ ok: false, reason: "contact_mismatch" });
  });

  it("says nothing about who is accepting once the link no longer works", () => {
    expect(
      accept({
        request: { ...live, expiresAt: now },
        accepter: {
          isTheRequester: true,
          isTheRequestedContact: false,
          guardianVerified: false,
          ownProfile: "minor",
        },
      })
    ).toEqual({ ok: false, reason: "expired" });
  });
});
