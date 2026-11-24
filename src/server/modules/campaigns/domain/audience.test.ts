import { describe, expect, it } from "vitest";

import {
  basisHolds,
  planAudience,
  type AudienceCandidate,
  type ConsentStatus,
} from "./audience";
import type { SegmentAttributes, SegmentDefinition } from "./segment";

const EVERYONE: SegmentDefinition = {
  roles: [],
  competitionIds: [],
  cities: [],
};
const PLAIN: SegmentAttributes = { roles: [], competitionIds: [], cities: [] };

const given = (giverUserId: string): ConsentStatus => ({
  status: "given",
  giverUserId,
});
const withdrawn = (giverUserId: string): ConsentStatus => ({
  status: "withdrawn",
  giverUserId,
});
const never: ConsentStatus = { status: "never" };

function adult(
  userId: string,
  messagesConsent: ConsentStatus,
  attributes: Partial<SegmentAttributes> = {}
): AudienceCandidate {
  return {
    kind: "adult",
    userId,
    attributes: { ...PLAIN, ...attributes },
    messagesConsent,
  };
}

function child(
  profileId: string,
  communicationsConsent: ConsentStatus,
  options: {
    guardians?: string[];
    loginUserId?: string;
    attributes?: Partial<SegmentAttributes>;
  } = {}
): AudienceCandidate {
  return {
    kind: "child",
    profileId,
    loginUserId: options.loginUserId ?? null,
    attributes: { ...PLAIN, ...options.attributes },
    communicationsConsent,
    activeGuardianUserIds: options.guardians ?? [],
  };
}

describe("planAudience", () => {
  it("holds only adults whose consent to News and updates is given now", () => {
    const plan = planAudience(EVERYONE, [
      adult("u-asha", given("u-asha")),
      adult("u-ravi", withdrawn("u-ravi")),
      adult("u-meera", never),
    ]);
    expect(plan.recipients).toEqual([
      { userId: "u-asha", bases: [{ purpose: "messages", subjectId: "u-asha" }] },
    ]);
    expect(plan.counts).toEqual({
      matched: 3,
      members: 1,
      recipients: 1,
      noConsent: 2,
      noGuardian: 0,
    });
  });

  it("sends a child's message to the guardian who consented, never the child", () => {
    const plan = planAudience(EVERYONE, [
      adult("u-guardian", never),
      adult("u-teen", given("u-teen")),
      child("p-teen", given("u-guardian"), {
        guardians: ["u-guardian"],
        loginUserId: "u-teen",
      }),
    ]);
    expect(plan.recipients).toEqual([
      {
        userId: "u-guardian",
        bases: [{ purpose: "communications", subjectId: "p-teen" }],
      },
    ]);
    expect(plan.counts).toMatchObject({
      matched: 2,
      members: 1,
      recipients: 1,
      noConsent: 1,
    });
  });

  it("drops a child whose consent giver no longer looks after them", () => {
    const plan = planAudience(EVERYONE, [
      child("p-asha", given("u-old-guardian"), { guardians: ["u-new"] }),
    ]);
    expect(plan.recipients).toEqual([]);
    expect(plan.counts).toMatchObject({ matched: 1, noGuardian: 1 });
  });

  it("drops a child without consent", () => {
    const plan = planAudience(EVERYONE, [
      child("p-asha", withdrawn("u-guardian"), { guardians: ["u-guardian"] }),
      child("p-ravi", never, { guardians: ["u-guardian"] }),
    ]);
    expect(plan.recipients).toEqual([]);
    expect(plan.counts).toMatchObject({ matched: 2, noConsent: 2 });
  });

  it("sends one message to a guardian, resting on every consent involved", () => {
    const plan = planAudience(EVERYONE, [
      child("p-two", given("u-guardian"), { guardians: ["u-guardian"] }),
      adult("u-guardian", given("u-guardian")),
      child("p-one", given("u-guardian"), { guardians: ["u-guardian"] }),
    ]);
    expect(plan.recipients).toEqual([
      {
        userId: "u-guardian",
        bases: [
          { purpose: "messages", subjectId: "u-guardian" },
          { purpose: "communications", subjectId: "p-one" },
          { purpose: "communications", subjectId: "p-two" },
        ],
      },
    ]);
    expect(plan.counts).toMatchObject({ members: 3, recipients: 1 });
  });

  it("counts only people the definition matches", () => {
    const plan = planAudience({ ...EVERYONE, cities: ["Pune"] }, [
      adult("u-pune", given("u-pune"), { cities: ["pune"] }),
      adult("u-mumbai", given("u-mumbai"), { cities: ["Mumbai"] }),
      child("p-pune", given("u-guardian"), {
        guardians: ["u-guardian"],
        attributes: { cities: ["Pune"] },
      }),
    ]);
    expect(plan.recipients.map(({ userId }) => userId)).toEqual([
      "u-guardian",
      "u-pune",
    ]);
    expect(plan.counts.matched).toBe(2);
  });
});

describe("basisHolds", () => {
  it("needs a given consent to News and updates", () => {
    expect(
      basisHolds({ purpose: "messages", current: given("u-a") }, "u-a")
    ).toBe(true);
    expect(
      basisHolds({ purpose: "messages", current: withdrawn("u-a") }, "u-a")
    ).toBe(false);
  });

  it("needs a child's consent given by the recipient, still their guardian", () => {
    const current = given("u-guardian");
    expect(
      basisHolds(
        { purpose: "communications", current, recipientIsActiveGuardian: true },
        "u-guardian"
      )
    ).toBe(true);
    expect(
      basisHolds(
        {
          purpose: "communications",
          current,
          recipientIsActiveGuardian: false,
        },
        "u-guardian"
      )
    ).toBe(false);
    expect(
      basisHolds(
        { purpose: "communications", current, recipientIsActiveGuardian: true },
        "u-other"
      )
    ).toBe(false);
  });
});
