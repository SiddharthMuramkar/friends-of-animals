import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  guardianInvitation,
  guardianLink,
  participantProfile,
  registration,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { paymentRows } from "@/server/modules/payments/testing";
import { bornYearsAgo, verifiedGuardian } from "@/server/modules/guardians/testing";
import { createHarness, type Harness } from "@/test/harness";

import { adultForm, openToIndividuals, participantRows } from "./testing";

// 81b: a teen with no guardian on the platform is held as pending_guardian
// until the guardian they named verifies and accepts. Until then nothing
// pays for or confirms the registration; once accepted, the guardian pays.

const MOTHER_EMAIL = "lakshmi.iyer@example.test";
const LINK = /\/invitations\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;

/** A 15-year-old who registered alone and named their mother. */
async function heldTeen(h: Harness, { fee }: { fee?: bigint } = {}) {
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
      dateOfBirth: bornYearsAgo(h, 15, 30),
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
});

describe("acceptGuardianRequest", () => {
  it("links the teen to the verified guardian asked, and releases the registration for the guardian to pay", async () => {
    const h = await createHarness();
    const meera = await heldTeen(h);
    const lakshmi = await verifiedGuardian(h, {
      name: "Lakshmi Iyer",
      email: MOTHER_EMAIL,
    });

    const result = await h
      .as(lakshmi.actor)
      .acceptGuardianRequest({ token: meera.token, relationship: "parent" });

    expect(result).toEqual({
      ok: true,
      childId: meera.profileId,
      released: [meera.registrationId],
    });
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
    const registered = await h.as(rohan).registerAsIndividual(
      adultForm(competition)
    );
    if (!registered.ok) throw new Error(JSON.stringify(registered));
    const pay = (actor: Awaited<ReturnType<typeof h.signIn>>) =>
      h
        .as(actor)
        .payForMyRegistration({ registrationId: registered.registrationId });

    await expect(pay(rohan)).rejects.toThrow(DomainError);
    await expect(pay(await h.signIn(await h.seed.member()))).rejects.toThrow(
      DomainError
    );
    expect(await pay(await h.signIn(family.account))).toMatchObject({
      ok: true,
      kind: "checkout",
    });
  });
});
