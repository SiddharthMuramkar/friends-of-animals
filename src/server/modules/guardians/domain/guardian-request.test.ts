import { describe, expect, it } from "vitest";

import {
  decideGuardianRequest,
  decideGuardianRequestAcceptance,
} from "./guardian-request";

const now = new Date("2026-11-21T10:00:00Z");
const teenEmail = { channel: "email", address: "teen2@example.test" } as const;
const mother = { channel: "email", address: "mother@example.test" } as const;

describe("decideGuardianRequest", () => {
  it("sends a request to the guardian a teen names, open for 7 days", () => {
    expect(
      decideGuardianRequest({
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

  it("refuses a teen naming their own email address or phone number as the guardian's", () => {
    const teenPhone = { channel: "phone", address: "+919800000002" } as const;
    for (const guardianContact of [teenEmail, teenPhone]) {
      expect(
        decideGuardianRequest({
          guardianContact,
          ownContacts: [teenEmail, teenPhone],
          pending: null,
          now,
        })
      ).toEqual({ ok: false, reason: "guardian_contact_is_self" });
    }
  });

  it("asks for the guardian's details when a teen with no guardian names nobody", () => {
    expect(
      decideGuardianRequest({
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
    const base = { guardianContact: null, ownContacts: [teenEmail], now };
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
  };
  const accept = (
    change: Partial<Parameters<typeof decideGuardianRequestAcceptance>[0]>
  ) =>
    decideGuardianRequestAcceptance({
      request: live,
      now,
      accepter: mother,
      childAlreadyAdded: false,
      teenLinkedElsewhere: false,
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
      { teenLinkedElsewhere: true },
      "already_linked",
    ],
  ])("refuses when %s", (_, change, reason) => {
    expect(accept(change)).toEqual({ ok: false, reason });
  });

  it("says nothing about who is accepting once the link no longer works", () => {
    expect(
      accept({
        request: { ...live, expiresAt: now },
        accepter: {
          isTheRequester: true,
          isTheRequestedContact: false,
          guardianVerified: false,
        },
      })
    ).toEqual({ ok: false, reason: "expired" });
  });
});
