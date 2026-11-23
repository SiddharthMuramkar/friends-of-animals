import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { createLinkToken } from "@/server/crypto/link-token";
import { guardianInvitation } from "@/server/db/schema";
import {
  adultForm,
  openToIndividuals,
} from "@/server/modules/participants/testing";
import { formatIsoDate } from "@/server/modules/registration/domain/calendar-date";
import { bornYearsAgo } from "@/server/seed/guardians";
import { createPgWorld, type PgWorld } from "@/test/pg";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

it("keeps separate registrations while the invited teen accepts their login invitation", async () => {
  const name = "Meera Iyer";
  const motherEmail = world.uniqueEmail();
  const family = await world.seed.guardian({
    name: "Lakshmi Iyer",
    email: motherEmail,
    children: [{ fullName: name, age: 15 }],
  });
  const childId = family.childIds[0]!;
  const parent = world.as(await world.signedIn(family.account));
  const requester = await world.seed.member({
    name,
    email: world.uniqueEmail(),
  });
  const invitee = await world.seed.member({ name, email: world.uniqueEmail() });
  const teen = world.as(await world.signedIn(requester));
  const invited = world.as(await world.signedIn(invitee));
  const competition = await openToIndividuals(world, {
    code: "CLAIM82",
    name: "Guardian claim",
  });
  const registration = await teen.registerAsIndividual({
    ...adultForm(competition, {
      fullName: name,
      dateOfBirth: formatIsoDate(bornYearsAgo(world.clock.now(), 15, 30)),
    }),
    guardian: {
      fullName: "Lakshmi Iyer",
      relationship: "parent",
      email: motherEmail,
    },
  });
  if (!registration.ok) throw new Error(registration.error);
  const invitation = await parent.inviteTeenLogin({
    childId,
    email: invitee.email,
  });
  if (!invitation.ok) throw new Error(invitation.error);

  // Use known tokens for the two links that production sends through the outbox.
  const requestLink = createLinkToken();
  const loginLink = createLinkToken();
  await world.db
    .update(guardianInvitation)
    .set({ tokenHash: requestLink.tokenHash })
    .where(
      and(
        eq(guardianInvitation.requestedByUserId, requester.id),
        eq(guardianInvitation.kind, "guardian_request")
      )
    );
  await world.db
    .update(guardianInvitation)
    .set({ tokenHash: loginLink.tokenHash })
    .where(eq(guardianInvitation.id, invitation.invitationId));

  const { acceptingRequest, signingIn } = await world.sql.begin(
    async (blocker) => {
      // Queue both actions on the profile, with the guardian's request first.
      await blocker`select 1 from participant_profile where id = ${childId} for update`;
      const acceptingRequest = parent.acceptGuardianRequest({
        token: requestLink.token,
        relationship: "parent",
      });
      acceptingRequest.catch(() => {});
      await world.waitForLockWaiters(1);
      const signingIn = invited.acceptTeenInvitation({
        token: loginLink.token,
      });
      signingIn.catch(() => {});
      await world.waitForLockWaiters(2);
      return { acceptingRequest, signingIn };
    }
  );

  await expect(Promise.all([acceptingRequest, signingIn])).resolves.toEqual([
    { ok: false, error: "child_already_added" },
    { ok: true, childId },
  ]);
  expect(
    await parent.viewGuardianRequest({ token: requestLink.token })
  ).toMatchObject({
    ok: true,
    request: { status: "pending" },
  });
  expect(await teen.listMyRegistrations()).toMatchObject([
    { registrationId: registration.registrationId, heldFor: "guardian" },
  ]);
  expect(await invited.listMyRegistrations()).toEqual([]);
});
