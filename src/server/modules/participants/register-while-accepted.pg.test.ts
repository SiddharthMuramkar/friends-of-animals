// A teen registering for a second competition while the guardian they
// asked accepts, from separate connections on real PostgreSQL (`pnpm
// test:pg`). Accepting locks the teen's account as registering does, so
// the two take turns; a registration that read "a profile of their own"
// before the guardian accepted registers on the profile the guardian now
// keeps, instead of making the teen a second profile and asking again.

import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLinkToken } from "@/server/crypto/link-token";
import {
  guardianInvitation,
  participantProfile,
  registration,
} from "@/server/db/schema";
import { formatIsoDate } from "@/server/modules/registration/domain/calendar-date";
import { bornYearsAgo } from "@/server/seed/guardians";
import { createPgWorld, type PgWorld } from "@/test/pg";

import { adultForm, openToIndividuals } from "./testing";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

/** A competition open to individuals, with a code no earlier run used. */
function openCompetition() {
  const letters = Array.from({ length: 5 }, () =>
    String.fromCharCode(65 + randomInt(26))
  ).join("");
  const code = `${letters}27`;
  // Its own name too: the slug is made from it.
  return openToIndividuals(world, { code, name: `Accept race ${code}` });
}

describe("a teen registering while their guardian accepts", () => {
  it("registers on the profile the guardian now keeps, asking nobody again", async () => {
    const motherEmail = world.uniqueEmail();
    const mother = await world.seed.guardian({
      name: "Lakshmi Iyer",
      email: motherEmail,
      children: [],
    });
    const teen = await world.seed.member({
      name: "Meera Iyer",
      email: world.uniqueEmail(),
    });
    const meera = world.as(await world.signedIn(teen));
    const lakshmi = world.as(await world.signedIn(mother.account));
    const first = await openCompetition();
    const second = await openCompetition();
    const teenForm = (competition: typeof first) => ({
      ...adultForm(competition, {
        fullName: "Meera Iyer",
        dateOfBirth: formatIsoDate(bornYearsAgo(world.clock.now(), 15, 30)),
      }),
      guardian: {
        fullName: "Lakshmi Iyer",
        relationship: "parent",
        email: motherEmail,
      },
    });
    const held = await meera.registerAsIndividual(teenForm(first));
    if (!held.ok) throw new Error(held.error);
    // The emailed link's token, which the outbox would send: a known one.
    const { token, tokenHash } = createLinkToken();
    await world.db
      .update(guardianInvitation)
      .set({ tokenHash })
      .where(eq(guardianInvitation.requestedByUserId, teen.id));

    // Another request holds the teen's account, so the guardian's accept
    // queues behind it first, then the teen's second registration.
    const blocker = await world.sql.reserve();
    let results;
    try {
      await blocker`begin`;
      await blocker`select 1 from "user" where id = ${teen.id} for no key update`;
      const accepting = lakshmi.acceptGuardianRequest({
        token,
        relationship: "parent",
      });
      accepting.catch(() => {});
      await world.waitForLockWaiters(1);
      const registering = meera.registerAsIndividual(teenForm(second));
      registering.catch(() => {});
      await world.waitForLockWaiters(2);
      await blocker`commit`;
      results = await Promise.all([accepting, registering]);
    } finally {
      blocker.release();
    }

    const [accepted, registered] = results;
    // Both stay held for the guardian's participation consent (#82).
    expect(accepted).toMatchObject({ ok: true, released: [] });
    // A linked teen whose guardian has verified: held for that consent,
    // and then the guardian pays.
    expect(registered).toMatchObject({
      ok: true,
      status: "pending_guardian",
      payNow: false,
    });
    const profiles = await world.db
      .select({
        id: participantProfile.id,
        ownerKind: participantProfile.ownerKind,
      })
      .from(participantProfile)
      .where(eq(participantProfile.loginUserId, teen.id));
    expect(profiles).toEqual([
      { id: expect.any(String), ownerKind: "guardian" },
    ]);
    expect(
      await world.db
        .select({ id: participantProfile.id })
        .from(participantProfile)
        .where(
          and(
            eq(participantProfile.ownerUserId, teen.id),
            eq(participantProfile.ownerKind, "self")
          )
        )
    ).toEqual([]);
    const registrations = await world.db
      .select({
        profileId: registration.participantProfileId,
        status: registration.status,
      })
      .from(registration)
      .where(eq(registration.participantProfileId, profiles[0]!.id));
    expect(registrations).toHaveLength(2);
    expect(registrations.map((row) => row.status)).toEqual([
      "pending_guardian",
      "pending_guardian",
    ]);
    expect(
      await world.db
        .select({ status: guardianInvitation.status })
        .from(guardianInvitation)
        .where(eq(guardianInvitation.requestedByUserId, teen.id))
    ).toEqual([{ status: "accepted" }]);
  });
});
