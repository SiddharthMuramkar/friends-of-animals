import { describe, expect, it } from "vitest";

import {
  decideRecipient,
  type ConsentStatus,
  type InvitationSubject,
} from "./recipient";

const given = (eventId: string, giverUserId: string): ConsentStatus => ({
  status: "given",
  eventId,
  giverUserId,
});
const withdrawn = (eventId: string, giverUserId: string): ConsentStatus => ({
  status: "withdrawn",
  eventId,
  giverUserId,
});
const never: ConsentStatus = { status: "never" };

function adult(overrides: Partial<InvitationSubject> = {}): InvitationSubject {
  return {
    ageYears: 30,
    ownUserId: "user-adult",
    messagesConsent: given("event-own", "user-adult"),
    communicationsConsent: never,
    activeGuardianUserIds: [],
    ...overrides,
  };
}

function child(overrides: Partial<InvitationSubject> = {}): InvitationSubject {
  return {
    ageYears: 10,
    ownUserId: null,
    messagesConsent: never,
    communicationsConsent: given("event-child", "user-guardian"),
    activeGuardianUserIds: ["user-guardian"],
    ...overrides,
  };
}

describe("decideRecipient: adults", () => {
  it("invites an adult with their own consent to messages, on that consent", () => {
    expect(decideRecipient(adult())).toEqual({
      ok: true,
      recipient: { userId: "user-adult", relation: "self" },
      basis: { purpose: "messages", eventId: "event-own" },
    });
  });

  it("treats someone who turned 18 as an adult", () => {
    expect(decideRecipient(adult({ ageYears: 18 }))).toMatchObject({
      ok: true,
      recipient: { relation: "self" },
    });
  });

  it.each([
    ["never given", never],
    ["withdrawn", withdrawn("event-own", "user-adult")],
  ])("skips an adult whose consent was %s", (_, messagesConsent) => {
    expect(decideRecipient(adult({ messagesConsent }))).toEqual({
      ok: false,
      reason: "no_consent",
    });
  });

  it("skips an adult with no login of their own, consent or not", () => {
    expect(decideRecipient(adult({ ownUserId: null }))).toEqual({
      ok: false,
      reason: "no_login",
    });
  });

  it("ignores a guardian's consent for an adult", () => {
    expect(
      decideRecipient(
        adult({
          messagesConsent: never,
          communicationsConsent: given("event-old", "user-guardian"),
          activeGuardianUserIds: ["user-guardian"],
        })
      )
    ).toEqual({ ok: false, reason: "no_consent" });
  });
});

describe("decideRecipient: minors", () => {
  it("invites a child's guardian on the child's communications consent", () => {
    expect(decideRecipient(child())).toEqual({
      ok: true,
      recipient: { userId: "user-guardian", relation: "guardian" },
      basis: { purpose: "communications", eventId: "event-child" },
    });
  });

  it("sends a teen's invitation to the guardian, never to the teen's own login", () => {
    expect(
      decideRecipient(
        child({
          ageYears: 17,
          ownUserId: "user-teen",
          messagesConsent: given("event-teen", "user-teen"),
        })
      )
    ).toEqual({
      ok: true,
      recipient: { userId: "user-guardian", relation: "guardian" },
      basis: { purpose: "communications", eventId: "event-child" },
    });
  });

  it("skips a teen whose only consent is their own", () => {
    expect(
      decideRecipient(
        child({
          ageYears: 15,
          ownUserId: "user-teen",
          messagesConsent: given("event-teen", "user-teen"),
          communicationsConsent: never,
        })
      )
    ).toEqual({ ok: false, reason: "no_consent" });
  });

  it("treats an unknown age as a minor, so no one is contacted without a guardian", () => {
    expect(
      decideRecipient(adult({ ageYears: null, communicationsConsent: never }))
    ).toEqual({ ok: false, reason: "no_consent" });
    expect(decideRecipient(child({ ageYears: null }))).toMatchObject({
      ok: true,
      recipient: { relation: "guardian" },
    });
  });

  it.each([
    ["never given", never],
    ["withdrawn", withdrawn("event-child", "user-guardian")],
  ])("skips a child whose consent was %s", (_, communicationsConsent) => {
    expect(decideRecipient(child({ communicationsConsent }))).toEqual({
      ok: false,
      reason: "no_consent",
    });
  });

  it("skips a child whose consent giver is no longer an active guardian", () => {
    expect(decideRecipient(child({ activeGuardianUserIds: [] }))).toEqual({
      ok: false,
      reason: "no_guardian",
    });
  });

  it("never sends to another active guardian who did not give the consent", () => {
    expect(
      decideRecipient(child({ activeGuardianUserIds: ["user-other-guardian"] }))
    ).toEqual({ ok: false, reason: "no_guardian" });
  });
});
