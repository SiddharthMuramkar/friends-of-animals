import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  guardian,
  guardianInvitation,
  guardianLink,
  participantProfile,
  registration,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { addGuardianFamily } from "@/server/seed/guardians";
import { paymentRows } from "@/server/modules/payments/testing";
import {
  bornYearsAgo,
  verifiedGuardian,
} from "@/server/modules/guardians/testing";
import { createHarness, type Harness } from "@/test/harness";

import { adultForm, openToIndividuals, participantRows } from "./testing";

// #81: a teen with no guardian on the platform is held as pending_guardian
// until the guardian they named verifies and accepts. Until then nothing
// pays for or confirms the registration; once accepted, the guardian pays.

const MOTHER_EMAIL = "lakshmi.iyer@example.test";
const LINK = /\/invitations\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;

/** A 15-year-old (or `dateOfBirth`) who registered alone and named their mother. */
async function heldTeen(
  h: Harness,
  { fee, dateOfBirth }: { fee?: bigint; dateOfBirth?: string } = {}
) {
  const competition = await openToIndividuals(h, {
    ...(fee === undefined ? {} : { fee }),
    name: "Paws 2027",
  });
  const account = await h.seed.member({
    name: "Meera Iyer",
    email: "meera@example.test",
  });
  const actor = await h.signIn(account);
  const result = await h.as(actor).registerAsIndividual({
    ...adultForm(competition, {
      fullName: "Meera Iyer",
      dateOfBirth: dateOfBirth ?? bornYearsAgo(h, 15, 30),
    }),
    guardian: {
      fullName: "Lakshmi Iyer",
      relationship: "parent",
      email: MOTHER_EMAIL,
    },
  });
  if (!result.ok || result.status !== "pending_guardian") {
    throw new Error(JSON.stringify(result));
  }
  await h.drain();
  const token = LINK.exec(h.email.lastTo(MOTHER_EMAIL)?.text ?? "")?.[1];
  if (!token) throw new Error("No guardian request was emailed");
  const [profile] = await h.db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(eq(participantProfile.ownerUserId, account.id));
  return {
    account,
    actor,
    competition,
    token,
    profileId: profile!.id,
    registrationId: result.registrationId,
    status: async () => {
      const [row] = await h.db
        .select({ status: registration.status })
        .from(registration)
        .where(eq(registration.id, result.registrationId));
      return row?.status;
    },
  };
}

describe("a registration held for a guardian", () => {
  it("can't be paid for: no batch and no gateway order", async () => {
    const h = await createHarness();
    const meera = await heldTeen(h);
    const before = await paymentRows(h);

    expect(
      await h
        .as(meera.actor)
        .payForMyRegistration({ registrationId: meera.registrationId })
    ).toEqual({ ok: false, error: "awaiting_guardian" });
    expect(await paymentRows(h)).toEqual(before);
    expect(h.gateway.orders).toEqual([]);
    expect(await meera.status()).toBe("pending_guardian");
  });

  it("isn't confirmed on a free competition either", async () => {
    const h = await createHarness();
    const meera = await heldTeen(h, { fee: 0n });

    expect(
      await h
        .as(meera.actor)
        .payForMyRegistration({ registrationId: meera.registrationId })
    ).toEqual({ ok: false, error: "awaiting_guardian" });
    expect(await meera.status()).toBe("pending_guardian");
  });

  it("lets the participant continue the same registration after turning 18", async () => {
    const h = await createHarness();
    const meera = await heldTeen(h, {
      fee: 0n,
      dateOfBirth: bornYearsAgo(h, 18, -3),
    });
    const mine = h.as(meera.actor);
    h.clock.advance({ days: 4 });

    expect(await mine.listMyRegistrations()).toEqual([
      expect.objectContaining({
        registrationId: meera.registrationId,
        amountDue: { amountMinor: 0n, currency: "INR" },
        heldFor: null,
      }),
    ]);

    const confirmed = await mine.payForMyRegistration({
      registrationId: meera.registrationId,
    });
    expect(confirmed).toMatchObject({ ok: true, kind: "confirmed_free" });
    expect(await meera.status()).toBe("confirmed");
    expect(h.gateway.orders).toEqual([]);
    expect(
      await h.as(h.visitor()).viewGuardianRequest({ token: meera.token })
    ).toMatchObject({ ok: true, request: { status: "revoked", teen: null } });
  });
});

describe("registerAsGuardian, after registering alone", () => {
  it("refuses a teen held for a guardian, storing nothing: they can't verify or add a child", async () => {
    const h = await createHarness();
    const meera = await heldTeen(h);

    expect(
      await h
        .as(meera.actor)
        .registerAsGuardian({ fullName: "Meera Iyer", adultDeclared: true })
    ).toEqual({ ok: false, error: "registered_as_minor" });
    expect(await h.db.select().from(guardian)).toEqual([]);
    expect(await h.as(meera.actor).startGuardianVerification()).toEqual({
      ok: false,
      error: "not_registered",
    });
    await expect(
      h.as(meera.actor).addChild({
        fullName: "Meera Iyer",
        dateOfBirth: bornYearsAgo(h, 15, 30),
        relationship: "parent",
      })
    ).rejects.toThrow(DomainError);
    expect(await meera.status()).toBe("pending_guardian");
  });

  it("lets an adult who registered themselves declare as a guardian", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);
    const actor = await h.signIn(
      await h.seed.member({ name: "Lakshmi Iyer", email: MOTHER_EMAIL })
    );
    expect(
      await h
        .as(actor)
        .registerAsIndividual(
          adultForm(competition, { fullName: "Lakshmi Iyer" })
        )
    ).toMatchObject({ ok: true, status: "pending_payment" });

    expect(
      await h
        .as(actor)
        .registerAsGuardian({ fullName: "Lakshmi Iyer", adultDeclared: true })
    ).toEqual({ ok: true });
  });
});

describe("a date of birth already on a profile of one's own", () => {
  async function rows(h: Harness) {
    return {
      participants: await participantRows(h),
      requests: await h.db.select().from(guardianInvitation),
    };
  }

  it("keeps a teen held for a guardian held when they type an adult's on their next form", async () => {
    const h = await createHarness();
    const meera = await heldTeen(h);
    const second = await openToIndividuals(h, { name: "Wings 2027" });
    const before = await rows(h);

    expect(
      await h.as(meera.actor).registerAsIndividual(
        adultForm(second, {
          fullName: "Meera Iyer",
          dateOfBirth: bornYearsAgo(h, 25),
        })
      )
    ).toEqual({ ok: false, error: "dob_mismatch" });
    // Nothing written: the profile still holds a 15-year-old's date of birth.
    expect(await rows(h)).toEqual(before);
    expect(await meera.status()).toBe("pending_guardian");
    expect(
      await h
        .as(meera.actor)
        .payForMyRegistration({ registrationId: meera.registrationId })
    ).toEqual({ ok: false, error: "awaiting_guardian" });
    expect(
      await h
        .as(meera.actor)
        .registerAsGuardian({ fullName: "Meera Iyer", adultDeclared: true })
    ).toEqual({ ok: false, error: "registered_as_minor" });
  });

  it("keeps an adult who registered an adult when they type a teen's on their next form", async () => {
    const h = await createHarness();
    const first = await openToIndividuals(h, { fee: 0n, name: "Paws 2027" });
    const second = await openToIndividuals(h, { name: "Wings 2027" });
    const actor = await h.signIn(
      await h.seed.member({ name: "Meera Iyer", email: "meera@example.test" })
    );
    expect(
      await h
        .as(actor)
        .registerAsIndividual(adultForm(first, { fullName: "Meera Iyer" }))
    ).toMatchObject({ ok: true, status: "pending_payment" });
    const before = await rows(h);

    expect(
      await h.as(actor).registerAsIndividual({
        ...adultForm(second, {
          fullName: "Meera Iyer",
          dateOfBirth: bornYearsAgo(h, 15, 30),
        }),
        guardian: {
          fullName: "Lakshmi Iyer",
          relationship: "parent",
          email: MOTHER_EMAIL,
        },
      })
    ).toEqual({ ok: false, error: "dob_mismatch" });
    expect(await rows(h)).toEqual(before);
    await h.drain();
    expect(h.email.lastTo(MOTHER_EMAIL)).toBeUndefined();
    // Still an adult's account: it may declare as a guardian.
    expect(
      await h
        .as(actor)
        .registerAsGuardian({ fullName: "Meera Iyer", adultDeclared: true })
    ).toEqual({ ok: true });
  });

  it("lets a teen held for a guardian register again with the same one, held for the same request", async () => {
    const h = await createHarness();
    const meera = await heldTeen(h);
    const second = await openToIndividuals(h, { name: "Wings 2027" });
    const [request] = await h.db.select().from(guardianInvitation);

    expect(
      await h.as(meera.actor).registerAsIndividual({
        ...adultForm(second, {
          fullName: "Meera Iyer",
          // The one heldTeen typed.
          dateOfBirth: bornYearsAgo(h, 15, 30),
        }),
        guardian: {
          fullName: "Lakshmi Iyer",
          relationship: "parent",
          email: MOTHER_EMAIL,
        },
      })
    ).toMatchObject({ ok: true, status: "pending_guardian", payNow: false });
    expect(await h.db.select().from(guardianInvitation)).toEqual([request]);
  });
});

describe("acceptGuardianRequest", () => {
  it("links the teen to the verified guardian asked, whose participation consent releases the registration for them to pay", async () => {
    const h = await createHarness();
    const meera = await heldTeen(h);
    const lakshmi = await verifiedGuardian(h, {
      name: "Lakshmi Iyer",
      email: MOTHER_EMAIL,
    });

    const result = await h
      .as(lakshmi.actor)
      .acceptGuardianRequest({ token: meera.token, relationship: "parent" });

    // Held still: the guardian hasn't given participation yet (#82).
    expect(result).toEqual({
      ok: true,
      childId: meera.profileId,
      released: [],
    });
    expect(await meera.status()).toBe("pending_guardian");
    expect(
      await h.as(lakshmi.actor).giveChildConsent({
        childId: meera.profileId,
        competitionId: meera.competition.id,
        purpose: "participation",
        documentId: meera.competition.guardianDocuments.participation!,
      })
    ).toEqual({ ok: true, changed: true });
    const [profile] = await h.db
      .select()
      .from(participantProfile)
      .where(eq(participantProfile.id, meera.profileId));
    expect(profile).toMatchObject({
      ownerKind: "guardian",
      ownerUserId: lakshmi.account.id,
      loginUserId: meera.account.id,
    });
    expect(await h.db.select().from(guardianLink)).toEqual([
      expect.objectContaining({
        participantProfileId: meera.profileId,
        relationship: "parent",
        revokedAt: null,
      }),
    ]);
    expect(await meera.status()).toBe("pending_payment");
    const actions = (
      await h.db.select({ action: auditLog.action }).from(auditLog)
    ).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "guardian.request_accepted",
        "registration.status_changed",
      ])
    );

    // Now the guardian pays; the teen no longer can.
    expect(
      await h
        .as(lakshmi.actor)
        .payForMyRegistration({ registrationId: meera.registrationId })
    ).toMatchObject({ ok: true, kind: "checkout" });
    await expect(
      h
        .as(meera.actor)
        .payForMyRegistration({ registrationId: meera.registrationId })
    ).rejects.toThrow(DomainError);
    // The guardian sees their child's place by name, and what it costs.
    expect(await h.as(lakshmi.actor).listMyRegistrations()).toEqual([
      expect.objectContaining({
        registrationId: meera.registrationId,
        participantName: "Meera Iyer",
        whose: "child",
        status: "pending_payment",
        amountDue: expect.objectContaining({ currency: "INR" }),
      }),
    ]);
    // The teen sees it too, as their own, with nothing for them to pay.
    expect(await h.as(meera.actor).listMyRegistrations()).toEqual([
      expect.objectContaining({
        registrationId: meera.registrationId,
        whose: "mine",
        status: "pending_payment",
        amountDue: null,
      }),
    ]);
  });

  it("leaves the teen's login without the guardian role: they can't add a sibling or declare as one", async () => {
    const h = await createHarness();
    const meera = await heldTeen(h);
    const lakshmi = await verifiedGuardian(h, {
      name: "Lakshmi Iyer",
      email: MOTHER_EMAIL,
    });
    expect(
      await h
        .as(lakshmi.actor)
        .acceptGuardianRequest({ token: meera.token, relationship: "parent" })
    ).toMatchObject({ ok: true });

    await expect(
      h.as(meera.actor).addChild({
        fullName: "Sibling Two",
        dateOfBirth: bornYearsAgo(h, 8),
        relationship: "parent",
      })
    ).rejects.toThrow(DomainError);
    expect(
      await h
        .as(meera.actor)
        .registerAsGuardian({ fullName: "Meera Iyer", adultDeclared: true })
    ).toEqual({ ok: false, error: "linked_child" });
    expect(
      await h.db
        .select({ id: participantProfile.id })
        .from(participantProfile)
        .where(eq(participantProfile.ownerUserId, lakshmi.account.id))
    ).toEqual([{ id: meera.profileId }]);
  });

  it.each([false, true])(
    "claims the held place for an existing child profile (already registered: %s)",
    async (hasRegistration) => {
      const h = await createHarness();
      const meera = await heldTeen(h);
      const lakshmi = await verifiedGuardian(h, {
        name: "Lakshmi Iyer",
        email: MOTHER_EMAIL,
      });
      const [teen] = await h.db
        .select({ dobCiphertext: participantProfile.dobCiphertext })
        .from(participantProfile)
        .where(eq(participantProfile.id, meera.profileId));
      const added = await h.as(lakshmi.actor).addChild({
        fullName: "Meera Iyer",
        dateOfBirth: h.deps.cipher.decrypt(
          "participant_profile.dob",
          teen!.dobCiphertext
        ),
        relationship: "parent",
      });
      if (!added.ok) throw new Error(JSON.stringify(added));
      const { childId } = added;
      const parent = h.as(lakshmi.actor);
      let liveId = meera.registrationId;
      if (hasRegistration) {
        const prior = await parent.registerAsIndividual({
          ...adultForm(meera.competition, {
            consents: meera.competition.documents.filter(
              (id) => id !== meera.competition.guardianDocuments.participation
            ),
          }),
          forChildId: childId,
        });
        expect(prior).toMatchObject({ ok: true, status: "pending_guardian" });
        if (!prior.ok) throw new Error(JSON.stringify(prior));
        liveId = prior.registrationId;
      }

      expect(
        await parent.acceptGuardianRequest({
          token: meera.token,
          relationship: "parent",
        })
      ).toEqual({ ok: true, childId, released: [] });
      expect(
        (await parent.listMyRegistrations()).filter(
          ({ status }) => status !== "withdrawn"
        )
      ).toEqual([
        expect.objectContaining({
          registrationId: liveId,
          childId,
          status: "pending_guardian",
          heldFor: "consent",
        }),
      ]);
      expect(
        (await h.as(meera.actor).listMyRegistrations()).filter(
          ({ status }) => status !== "withdrawn"
        )
      ).toEqual([
        expect.objectContaining({
          registrationId: liveId,
          whose: "mine",
          heldFor: "consent",
          amountDue: null,
        }),
      ]);
      expect(
        await parent.giveChildConsent({
          childId,
          competitionId: meera.competition.id,
          purpose: "participation",
          documentId: meera.competition.guardianDocuments.participation!,
        })
      ).toEqual({ ok: true, changed: true });
      expect(await meera.status()).toBe(
        hasRegistration ? "withdrawn" : "pending_payment"
      );
      expect(await parent.listMyRegistrations()).toContainEqual(
        expect.objectContaining({
          registrationId: liveId,
          childId,
          status: "pending_payment",
        })
      );
    }
  );

  describe("refuses, changing nothing,", () => {
    async function unchanged(h: Harness) {
      return {
        participants: await participantRows(h),
        requests: await h.db.select().from(guardianInvitation),
        links: await h.db.select().from(guardianLink),
      };
    }

    it("someone signed in with another address", async () => {
      const h = await createHarness();
      const meera = await heldTeen(h);
      const other = await verifiedGuardian(h, {
        name: "Someone Else",
        email: "someone@example.test",
      });
      const before = await unchanged(h);

      expect(
        await h
          .as(other.actor)
          .acceptGuardianRequest({ token: meera.token, relationship: "parent" })
      ).toEqual({ ok: false, error: "contact_mismatch" });
      expect(await unchanged(h)).toEqual(before);
    });

    it("the person asked, until they have verified as a guardian", async () => {
      const h = await createHarness();
      const meera = await heldTeen(h);
      const lakshmi = await h.signIn(
        await h.seed.member({ name: "Lakshmi Iyer", email: MOTHER_EMAIL })
      );
      const before = await unchanged(h);

      expect(
        await h
          .as(lakshmi)
          .acceptGuardianRequest({ token: meera.token, relationship: "parent" })
      ).toEqual({ ok: false, error: "guardian_not_verified" });
      expect(await unchanged(h)).toEqual(before);
    });

    it("a matching child's profile already linked to a different login", async () => {
      const h = await createHarness();
      const meera = await heldTeen(h);
      const login = await h.seed.member();
      const family = await h.seed.guardian({
        email: MOTHER_EMAIL,
        children: [{ fullName: "Meera Iyer", age: 15, loginUserId: login.id }],
      });
      const parent = h.as(await h.signIn(family.account));
      const before = await unchanged(h);
      expect(
        await parent.acceptGuardianRequest({
          token: meera.token,
          relationship: "parent",
        })
      ).toEqual({ ok: false, error: "child_already_added" });
      expect(await unchanged(h)).toEqual(before);
    });

    it("a visitor", async () => {
      const h = await createHarness();
      const meera = await heldTeen(h);
      const before = await unchanged(h);

      await expect(
        h
          .as(h.visitor())
          .acceptGuardianRequest({ token: meera.token, relationship: "parent" })
      ).rejects.toThrow(DomainError);
      expect(await unchanged(h)).toEqual(before);
    });

    it("a teen granted the guardian role since asking", async () => {
      const h = await createHarness();
      const meera = await heldTeen(h);
      // Declaring is refused to her (registered_as_minor); staff could
      // still grant the role.
      await h.seed.grant(meera.account, {
        role: "guardian",
        scope: { type: "global" },
      });
      const lakshmi = await verifiedGuardian(h, {
        name: "Lakshmi Iyer",
        email: MOTHER_EMAIL,
      });
      const before = await unchanged(h);

      expect(
        await h
          .as(lakshmi.actor)
          .acceptGuardianRequest({ token: meera.token, relationship: "parent" })
      ).toEqual({ ok: false, error: "requester_has_role" });
      expect(await unchanged(h)).toEqual(before);
      expect(await meera.status()).toBe("pending_guardian");
    });

    it.each([
      ["a judge's", { role: "judge", scope: { type: "global" } }],
      [
        "a staff member's",
        { role: "content_manager", scope: { type: "global" } },
      ],
    ] as const)("a teen whose account is %s since asking", async (_, grant) => {
      const h = await createHarness();
      const meera = await heldTeen(h);
      await h.seed.grant(meera.account, grant);
      const lakshmi = await verifiedGuardian(h, {
        name: "Lakshmi Iyer",
        email: MOTHER_EMAIL,
      });
      const before = await unchanged(h);

      expect(
        await h.as(lakshmi.actor).acceptGuardianRequest({
          token: meera.token,
          relationship: "parent",
        })
      ).toEqual({ ok: false, error: "requester_has_role" });
      expect(await unchanged(h)).toEqual(before);
    });

    it("a teen who has turned 18 since asking", async () => {
      const h = await createHarness();
      // 18 in three days; the link works for seven.
      const meera = await heldTeen(h, { dateOfBirth: bornYearsAgo(h, 18, -3) });
      const lakshmi = await verifiedGuardian(h, {
        name: "Lakshmi Iyer",
        email: MOTHER_EMAIL,
      });
      h.clock.advance({ days: 4 });
      const before = await unchanged(h);

      expect(
        await h
          .as(lakshmi.actor)
          .acceptGuardianRequest({ token: meera.token, relationship: "parent" })
      ).toEqual({ ok: false, error: "requester_is_adult" });
      expect(await unchanged(h)).toEqual(before);
    });

    it("a verified guardian whose own profile says they are under 18", async () => {
      const h = await createHarness();
      // Ravi, 14, registered alone and is held for his own guardian. He
      // can't declare as one now (registered_as_minor); this account was
      // made a verified guardian anyway, as no use case lets it be.
      const competition = await openToIndividuals(h, { name: "Wings 2027" });
      const raviAccount = await h.seed.member({
        name: "Ravi Kumar",
        email: MOTHER_EMAIL,
      });
      const ravi = await h.signIn(raviAccount);
      expect(
        await h.as(ravi).registerAsIndividual({
          ...adultForm(competition, {
            fullName: "Ravi Kumar",
            dateOfBirth: bornYearsAgo(h, 14, 30),
          }),
          guardian: {
            fullName: "Suresh Kumar",
            relationship: "parent",
            email: "suresh@example.test",
          },
        })
      ).toMatchObject({ ok: true, status: "pending_guardian" });
      await addGuardianFamily(h.deps, {
        userId: raviAccount.id,
        fullName: "Ravi Kumar",
        children: [],
      });
      // Meera, 15, names Ravi's address as her parent's.
      const meera = await heldTeen(h);
      const before = await unchanged(h);

      expect(
        await h
          .as(ravi)
          .acceptGuardianRequest({ token: meera.token, relationship: "parent" })
      ).toEqual({ ok: false, error: "accepter_is_minor" });
      expect(await unchanged(h)).toEqual(before);
      expect(await meera.status()).toBe("pending_guardian");
    });

    it("the teen who asked", async () => {
      const h = await createHarness();
      const meera = await heldTeen(h);
      const before = await unchanged(h);

      expect(
        await h
          .as(meera.actor)
          .acceptGuardianRequest({ token: meera.token, relationship: "parent" })
      ).toEqual({ ok: false, error: "requester_cannot_accept" });
      expect(await unchanged(h)).toEqual(before);
    });

    it("an expired link, a reused one and one that was never sent", async () => {
      const h = await createHarness();
      const meera = await heldTeen(h);
      const lakshmi = await verifiedGuardian(h, {
        name: "Lakshmi Iyer",
        email: MOTHER_EMAIL,
      });
      const accept = (token: string) =>
        h
          .as(lakshmi.actor)
          .acceptGuardianRequest({ token, relationship: "parent" });

      const sent = h.clock.now();
      h.clock.advance({ days: 7 });
      const before = await unchanged(h);
      expect(await accept(meera.token)).toEqual({
        ok: false,
        error: "expired",
      });
      expect(await unchanged(h)).toEqual(before);

      h.clock.set(sent);
      expect(await accept(meera.token)).toMatchObject({ ok: true });
      expect(await accept(meera.token)).toEqual({
        ok: false,
        error: "already_used",
      });
      expect(await accept("x".repeat(43))).toEqual({
        ok: false,
        error: "not_found",
      });
    });
  });
});

describe("viewGuardianRequest", () => {
  it("shows a link holder a masked address, and the teen and what waits only to the person asked", async () => {
    const h = await createHarness();
    const meera = await heldTeen(h);
    const lakshmi = await verifiedGuardian(h, {
      name: "Lakshmi Iyer",
      email: MOTHER_EMAIL,
    });
    const other = await h.signIn(await h.seed.member());
    const expiresAt = new Date(h.clock.now().getTime() + 7 * 86_400_000);

    const asVisitor = await h
      .as(h.visitor())
      .viewGuardianRequest({ token: meera.token });
    expect(asVisitor).toEqual({
      ok: true,
      request: {
        status: "pending",
        sentTo: "l***@example.test",
        expiresAt: expect.any(Date),
        forYou: null,
        teen: null,
        guardianVerified: null,
      },
    });
    if (asVisitor.ok) {
      expect(asVisitor.request.expiresAt.getTime()).toBeLessThanOrEqual(
        expiresAt.getTime()
      );
    }
    expect(
      await h.as(other).viewGuardianRequest({ token: meera.token })
    ).toMatchObject({ ok: true, request: { forYou: false, teen: null } });
    expect(
      await h.as(lakshmi.actor).viewGuardianRequest({ token: meera.token })
    ).toMatchObject({
      ok: true,
      request: {
        forYou: true,
        guardianVerified: true,
        teen: {
          name: "Meera Iyer",
          relationship: "parent",
          competitions: ["Paws 2027"],
        },
      },
    });
    expect(
      await h.as(h.visitor()).viewGuardianRequest({ token: "not-a-token" })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses anyone but a person at the link, such as a background job", async () => {
    const h = await createHarness();
    const meera = await heldTeen(h);

    await expect(
      h
        .as({ kind: "system", process: "worker" })
        .viewGuardianRequest({ token: meera.token })
    ).rejects.toThrow(DomainError);
  });

  it("tells the person asked that they still need to verify as a guardian", async () => {
    const h = await createHarness();
    const meera = await heldTeen(h);
    const lakshmi = await h.signIn(
      await h.seed.member({ name: "Lakshmi Iyer", email: MOTHER_EMAIL })
    );

    expect(
      await h.as(lakshmi).viewGuardianRequest({ token: meera.token })
    ).toMatchObject({
      ok: true,
      request: { forYou: true, guardianVerified: false },
    });
  });
});

describe("paying for a guardian's child", () => {
  it("lets the guardian pay, and refuses the child's own login and other members", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);
    const teen = await h.seed.member({ name: "Rohan Desai" });
    const family = await h.seed.guardian({
      children: [{ fullName: "Rohan Desai", age: 15, loginUserId: teen.id }],
    });
    const rohan = await h.signIn(teen);
    const registered = await h
      .as(rohan)
      .registerAsIndividual(adultForm(competition));
    if (!registered.ok) throw new Error(JSON.stringify(registered));
    const pay = (actor: Awaited<ReturnType<typeof h.signIn>>) =>
      h
        .as(actor)
        .payForMyRegistration({ registrationId: registered.registrationId });

    await expect(pay(rohan)).rejects.toThrow(DomainError);
    await expect(pay(await h.signIn(await h.seed.member()))).rejects.toThrow(
      DomainError
    );
    const guardianActor = await h.signIn(family.account);
    // Held for the guardian's participation consent first (#82).
    expect(await pay(guardianActor)).toEqual({
      ok: false,
      error: "awaiting_guardian",
    });
    await h.as(guardianActor).giveChildConsent({
      childId: family.childIds[0]!,
      competitionId: competition.id,
      purpose: "participation",
      documentId: competition.guardianDocuments.participation!,
    });
    expect(await pay(guardianActor)).toMatchObject({
      ok: true,
      kind: "checkout",
    });
  });
});
