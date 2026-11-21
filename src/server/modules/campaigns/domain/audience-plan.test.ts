import { describe, expect, it } from "vitest";

import {
  AudienceInputError,
  basisHolds,
  decideDelivery,
  planAudience,
  type AudienceCandidate,
  type BasisCheck,
  type ConsentStatus,
} from "./audience-plan";
import type {
  SegmentAttributes,
  SegmentDefinition,
} from "./segment-definition";

const EVERYONE: SegmentDefinition = {
  roles: [],
  cities: [],
  competitionIds: [],
  milestones: [],
};

const PLAIN: SegmentAttributes = {
  roles: ["member"],
  cities: ["Pune"],
  competitionIds: [],
  milestones: [],
};

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
const NEVER: ConsentStatus = { status: "never" };

function adult(
  userId: string,
  messagesConsent: ConsentStatus,
  attributes: SegmentAttributes = PLAIN
): AudienceCandidate {
  return { kind: "adult", userId, attributes, messagesConsent };
}

function minor(
  profileId: string,
  communicationsConsent: ConsentStatus,
  activeGuardianUserIds: readonly string[],
  options: { loginUserId?: string; attributes?: SegmentAttributes } = {}
): AudienceCandidate {
  return {
    kind: "minor",
    profileId,
    loginUserId: options.loginUserId ?? null,
    attributes: options.attributes ?? PLAIN,
    communicationsConsent,
    activeGuardianUserIds,
  };
}

describe("planAudience: consent", () => {
  it("sends to adults whose own consent is given, and to nobody else", () => {
    const plan = planAudience(EVERYONE, [
      adult("u-asha", given("e1", "u-asha")),
      adult("u-ravi", withdrawn("e2", "u-ravi")),
      adult("u-meera", NEVER),
    ]);
    expect(plan.deliveries).toEqual([
      {
        recipientUserId: "u-asha",
        bases: [{ purpose: "messages", eventId: "e1", aboutUserId: "u-asha" }],
      },
    ]);
    expect(plan.counts).toEqual({
      matched: 3,
      members: 1,
      recipients: 1,
      skipped: { noConsent: 2, noGuardian: 0 },
    });
  });

  it("leaves out a child whose communications consent isn't given", () => {
    const plan = planAudience(EVERYONE, [
      minor("p-kid1", withdrawn("e1", "u-guardian"), ["u-guardian"]),
      minor("p-kid2", NEVER, ["u-guardian"]),
    ]);
    expect(plan.deliveries).toEqual([]);
    expect(plan.counts.skipped).toEqual({ noConsent: 2, noGuardian: 0 });
  });

  it("counts nobody who doesn't match the definition", () => {
    const plan = planAudience({ ...EVERYONE, cities: ["Mumbai"] }, [
      adult("u-asha", given("e1", "u-asha")),
      adult("u-ravi", NEVER),
    ]);
    expect(plan).toEqual({
      deliveries: [],
      counts: {
        matched: 0,
        members: 0,
        recipients: 0,
        skipped: { noConsent: 0, noGuardian: 0 },
      },
    });
  });
});

describe("planAudience: minors go through their guardian", () => {
  it("sends a child's message to the guardian who gave the consent", () => {
    const plan = planAudience(EVERYONE, [
      minor("p-kid", given("e1", "u-mum"), ["u-mum", "u-dad"]),
    ]);
    expect(plan.deliveries).toEqual([
      {
        recipientUserId: "u-mum",
        bases: [
          {
            purpose: "communications",
            eventId: "e1",
            aboutProfileId: "p-kid",
          },
        ],
      },
    ]);
  });

  it("never sends to a teen's own login, even with their own consent", () => {
    const plan = planAudience(EVERYONE, [
      minor("p-teen", given("e1", "u-mum"), ["u-mum"], {
        loginUserId: "u-teen",
      }),
    ]);
    expect(plan.deliveries.map((d) => d.recipientUserId)).toEqual(["u-mum"]);
  });

  it("skips a child whose consent giver is no longer an active guardian", () => {
    const plan = planAudience(EVERYONE, [
      minor("p-kid", given("e1", "u-mum"), ["u-dad"]),
    ]);
    expect(plan.deliveries).toEqual([]);
    expect(plan.counts).toEqual({
      matched: 1,
      members: 0,
      recipients: 0,
      skipped: { noConsent: 0, noGuardian: 1 },
    });
  });

  it("gives a guardian of two children one message resting on both consents", () => {
    const plan = planAudience(EVERYONE, [
      minor("p-kid2", given("e2", "u-mum"), ["u-mum"]),
      minor("p-kid1", given("e1", "u-mum"), ["u-mum"]),
    ]);
    expect(plan.deliveries).toEqual([
      {
        recipientUserId: "u-mum",
        bases: [
          {
            purpose: "communications",
            eventId: "e1",
            aboutProfileId: "p-kid1",
          },
          {
            purpose: "communications",
            eventId: "e2",
            aboutProfileId: "p-kid2",
          },
        ],
      },
    ]);
    expect(plan.counts).toMatchObject({ members: 2, recipients: 1 });
  });

  it("merges a guardian who is in the segment themselves into one message", () => {
    const plan = planAudience(EVERYONE, [
      minor("p-kid", given("e2", "u-mum"), ["u-mum"]),
      adult("u-mum", given("e1", "u-mum")),
    ]);
    expect(plan.deliveries).toEqual([
      {
        recipientUserId: "u-mum",
        bases: [
          { purpose: "messages", eventId: "e1", aboutUserId: "u-mum" },
          {
            purpose: "communications",
            eventId: "e2",
            aboutProfileId: "p-kid",
          },
        ],
      },
    ]);
  });

  it("sends about a child even when the guardian withdrew their own consent", () => {
    // The child's communications consent is the basis; the guardian's own
    // news consent is about messages to them as a member.
    const plan = planAudience(EVERYONE, [
      minor("p-kid", given("e2", "u-mum"), ["u-mum"]),
      adult("u-mum", withdrawn("e1", "u-mum")),
    ]);
    expect(plan.deliveries).toEqual([
      {
        recipientUserId: "u-mum",
        bases: [
          {
            purpose: "communications",
            eventId: "e2",
            aboutProfileId: "p-kid",
          },
        ],
      },
    ]);
  });

  it("matches a child on their own attributes, not the guardian's", () => {
    const plan = planAudience({ ...EVERYONE, cities: ["Nagpur"] }, [
      minor("p-kid", given("e2", "u-mum"), ["u-mum"], {
        attributes: { ...PLAIN, cities: ["Nagpur"] },
      }),
      adult("u-mum", given("e1", "u-mum")),
    ]);
    expect(plan.deliveries).toEqual([
      {
        recipientUserId: "u-mum",
        bases: [
          {
            purpose: "communications",
            eventId: "e2",
            aboutProfileId: "p-kid",
          },
        ],
      },
    ]);
  });
});

describe("planAudience: input checks", () => {
  it("refuses a person listed twice", () => {
    expect(() =>
      planAudience(EVERYONE, [
        adult("u-asha", given("e1", "u-asha")),
        adult("u-asha", given("e1", "u-asha")),
      ])
    ).toThrow(AudienceInputError);
  });

  it("refuses a teen's login listed again as an adult", () => {
    expect(() =>
      planAudience(EVERYONE, [
        minor("p-teen", NEVER, [], { loginUserId: "u-teen" }),
        adult("u-teen", given("e1", "u-teen")),
      ])
    ).toThrow(AudienceInputError);
  });

  it("lists deliveries by recipient id whatever the input order", () => {
    const plan = planAudience(EVERYONE, [
      adult("u-c", given("e3", "u-c")),
      adult("u-a", given("e1", "u-a")),
      adult("u-b", given("e2", "u-b")),
    ]);
    expect(plan.deliveries.map((d) => d.recipientUserId)).toEqual([
      "u-a",
      "u-b",
      "u-c",
    ]);
  });
});

/** Mulberry32: a small seeded generator, so a failing world can be rerun. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CITIES = ["Pune", "Mumbai", "Nagpur"];
const ROLES = ["member", "guardian", "volunteer"];

/** A random world: adults, guardians, children with and without consent. */
function randomWorld(seed: number) {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)]!;
  const some = <T>(items: readonly T[]): T[] =>
    items.filter(() => random() < 0.4);
  const attributes = (): SegmentAttributes => ({
    roles: some(ROLES),
    cities: random() < 0.8 ? [pick(CITIES)] : [],
    competitionIds: some(["c1", "c2"]),
    milestones: some(["participant", "volunteer"]),
  });
  const consent = (eventId: string, giver: string): ConsentStatus => {
    const roll = random();
    if (roll < 0.5) return given(eventId, giver);
    if (roll < 0.75) return withdrawn(eventId, giver);
    return NEVER;
  };

  const adults = Array.from({ length: 12 }, (_, n) => `u-adult-${n}`);
  const candidates: AudienceCandidate[] = adults.map((userId, n) =>
    adult(userId, consent(`e-adult-${n}`, userId), attributes())
  );
  for (let n = 0; n < 15; n += 1) {
    const guardians = some(adults.slice(0, 6));
    const giver =
      random() < 0.8 && guardians.length > 0 ? pick(guardians) : pick(adults);
    candidates.push(
      minor(`p-kid-${n}`, consent(`e-kid-${n}`, giver), guardians, {
        ...(random() < 0.3 ? { loginUserId: `u-teen-${n}` } : {}),
        attributes: attributes(),
      })
    );
  }
  const definition: SegmentDefinition = {
    roles: some(ROLES),
    cities: some(CITIES),
    competitionIds: some(["c1", "c2"]),
    milestones: [],
  };
  return { candidates, definition };
}

describe("planAudience: invariants over random worlds", () => {
  const SEEDS = Array.from({ length: 200 }, (_, n) => n + 1);

  it.each(SEEDS)("world %i", (seed) => {
    const { candidates, definition } = randomWorld(seed);
    const plan = planAudience(definition, candidates);

    const adults = new Map(
      candidates.flatMap((c) => (c.kind === "adult" ? [[c.userId, c]] : []))
    );
    const minors = new Map(
      candidates.flatMap((c) => (c.kind === "minor" ? [[c.profileId, c]] : []))
    );
    const teenLogins = new Set(
      [...minors.values()].flatMap((c) =>
        c.kind === "minor" && c.loginUserId ? [c.loginUserId] : []
      )
    );

    const recipients = plan.deliveries.map((d) => d.recipientUserId);
    // One delivery per person, never to a child's own login.
    expect(new Set(recipients).size).toBe(recipients.length);
    for (const recipient of recipients) {
      expect(teenLogins.has(recipient)).toBe(false);
    }

    for (const delivery of plan.deliveries) {
      expect(delivery.bases.length).toBeGreaterThan(0);
      for (const basis of delivery.bases) {
        if (basis.purpose === "messages") {
          // An adult's own, current consent, to themselves.
          const person = adults.get(basis.aboutUserId);
          expect(basis.aboutUserId).toBe(delivery.recipientUserId);
          expect(person?.kind === "adult" && person.messagesConsent).toEqual(
            given(basis.eventId, basis.aboutUserId)
          );
        } else {
          // A child's current consent, to the active guardian who gave it.
          const child = minors.get(basis.aboutProfileId);
          if (child?.kind !== "minor") throw new Error("unknown child");
          expect(child.communicationsConsent).toEqual(
            given(basis.eventId, delivery.recipientUserId)
          );
          expect(child.activeGuardianUserIds).toContain(
            delivery.recipientUserId
          );
        }
      }
    }

    const { matched, members, recipients: count, skipped } = plan.counts;
    expect(matched).toBe(members + skipped.noConsent + skipped.noGuardian);
    expect(count).toBe(plan.deliveries.length);
    expect(members).toBe(
      plan.deliveries.reduce((sum, d) => sum + d.bases.length, 0)
    );
  });
});

describe("basisHolds", () => {
  it("holds for an adult's given consent and not otherwise", () => {
    expect(
      basisHolds({ purpose: "messages", current: given("e1", "u") }, "u")
    ).toBe(true);
    expect(
      basisHolds({ purpose: "messages", current: withdrawn("e2", "u") }, "u")
    ).toBe(false);
    expect(basisHolds({ purpose: "messages", current: NEVER }, "u")).toBe(
      false
    );
  });

  it.each([
    [given("e1", "u-mum"), true, true],
    [given("e1", "u-mum"), false, false],
    [given("e1", "u-dad"), true, false],
    [withdrawn("e1", "u-mum"), true, false],
    [NEVER, true, false],
  ])(
    "a child's consent %o, guardian active %s → %s",
    (current, recipientIsActiveGuardian, holds) => {
      expect(
        basisHolds(
          { purpose: "communications", current, recipientIsActiveGuardian },
          "u-mum"
        )
      ).toBe(holds);
    }
  );
});

describe("decideDelivery", () => {
  const ownGiven: BasisCheck = {
    purpose: "messages",
    current: given("e1", "u-mum"),
  };
  const ownWithdrawn: BasisCheck = {
    purpose: "messages",
    current: withdrawn("e3", "u-mum"),
  };
  const childGiven = {
    purpose: "communications" as const,
    current: given("e2", "u-mum"),
    recipientIsActiveGuardian: true,
  };
  const childRevoked: BasisCheck = {
    ...childGiven,
    recipientIsActiveGuardian: false,
  };

  it("sends while the campaign is sending and a basis holds", () => {
    expect(
      decideDelivery({
        campaignStatus: "sending",
        recipientUserId: "u-mum",
        bases: [ownGiven, childGiven],
      })
    ).toEqual({ action: "send", holding: [0, 1] });
  });

  it("still sends when one of two bases was withdrawn", () => {
    expect(
      decideDelivery({
        campaignStatus: "sending",
        recipientUserId: "u-mum",
        bases: [ownWithdrawn, childGiven],
      })
    ).toEqual({ action: "send", holding: [1] });
  });

  it("skips when every basis was withdrawn or the guardian link revoked", () => {
    expect(
      decideDelivery({
        campaignStatus: "sending",
        recipientUserId: "u-mum",
        bases: [ownWithdrawn, childRevoked],
      })
    ).toEqual({ action: "skip", reason: "consent_withdrawn" });
  });

  it.each(["draft", "sent", "cancelled"] as const)(
    "skips as cancelled when the campaign is %s",
    (campaignStatus) => {
      expect(
        decideDelivery({
          campaignStatus,
          recipientUserId: "u-mum",
          bases: [ownGiven],
        })
      ).toEqual({ action: "skip", reason: "cancelled" });
    }
  );
});
