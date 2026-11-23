// listMyRegistrations() (#78, #81): the participant dashboard's read model.
// The signed-in member's registrations, newest first: their own (on a
// profile of their own, or, for a teen whose login is linked, on the
// profile their guardian keeps) and, for a guardian, those of each child
// they look after. Each says whose it is, which competition, its status,
// the Participant ID, the registration number once confirmed, and what is
// still owed while it waits for payment, to whoever pays: the adult, or
// the child's guardian, never the child. Only those profiles are read, so
// nobody else's registrations ever show. Entries, results and
// certificates join it with later tickets.

import { and, desc, eq, inArray, or } from "drizzle-orm";

import { authorize } from "../../access/can";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionFee,
  guardian,
  guardianLink,
  participantProfile,
  registration,
} from "../../db/schema";
import type { Money } from "../../ports/payment-gateway";
import type { UseCaseContext } from "../../use-cases";
import { verifiedLink } from "../guardians/child-access";
import { ownProfileOf } from "../guardians/own-profile";
import type { RegistrationRoute } from "../registration/domain/participant";
import type { RegistrationStatus } from "../registration/domain/registration-status";

export type MyRegistration = {
  registrationId: string;
  /** The member's own, or a child's they look after as a guardian. */
  whose: "mine" | "child";
  participantName: string;
  competition: { name: string; slug: string };
  route: RegistrationRoute;
  status: RegistrationStatus;
  participantCode: string;
  /** Given once the registration is confirmed. */
  registrationNumber: string | null;
  /**
   * The individual fee still owed, to the member who pays it; null once
   * nothing is owed, or when someone else (a teen's guardian) pays.
   */
  amountDue: Money | null;
  /** The child's profile, for a guardian's own child; null otherwise. */
  childId: string | null;
  /**
   * What a held registration waits for: a guardian to confirm the teen
   * who registered alone (#81), or the guardian's participation consent
   * (#82); null when it isn't held.
   */
  heldFor: "guardian" | "consent" | null;
  createdAt: Date;
};

type Visible = { whose: "mine" | "child"; pays: boolean };

/** The profiles whose registrations `userId` sees, and how. */
async function visibleProfiles(
  db: AppDb,
  userId: string
): Promise<Map<string, Visible>> {
  const visible = new Map<string, Visible>();
  const mine = await db
    .select({
      id: participantProfile.id,
      ownerKind: participantProfile.ownerKind,
    })
    .from(participantProfile)
    .where(
      or(
        and(
          eq(participantProfile.ownerUserId, userId),
          eq(participantProfile.ownerKind, "self")
        ),
        eq(participantProfile.loginUserId, userId)
      )
    );
  for (const row of mine) {
    visible.set(row.id, { whose: "mine", pays: row.ownerKind === "self" });
  }
  const children = await db
    .select({ id: guardianLink.participantProfileId })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(and(eq(guardian.userId, userId), verifiedLink()));
  for (const row of children) {
    if (!visible.has(row.id)) {
      visible.set(row.id, { whose: "child", pays: true });
    }
  }
  return visible;
}

function signedInUserId(ctx: UseCaseContext, useCase: string): string {
  if (ctx.actor.kind !== "user") {
    throw new Error(`${useCase} needs a signed-in user`);
  }
  return ctx.actor.userId;
}

export async function listMyRegistrations(
  ctx: UseCaseContext
): Promise<MyRegistration[]> {
  await authorize(ctx, "registration.self.list");
  const userId = signedInUserId(ctx, "listMyRegistrations");
  const visible = await visibleProfiles(ctx.db, userId);
  if (visible.size === 0) return [];
  const rows = await ctx.db
    .select({
      registrationId: registration.id,
      profileId: registration.participantProfileId,
      participantName: participantProfile.fullName,
      competitionName: competition.name,
      competitionSlug: competition.slug,
      route: registration.route,
      status: registration.status,
      participantCode: participantProfile.participantCode,
      ownerKind: participantProfile.ownerKind,
      registrationNumber: registration.registrationNumber,
      fee: competitionFee.amountMinor,
      createdAt: registration.createdAt,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .innerJoin(competition, eq(competition.id, registration.competitionId))
    .leftJoin(
      competitionFee,
      and(
        eq(competitionFee.competitionId, registration.competitionId),
        eq(competitionFee.route, "individual")
      )
    )
    .where(
      and(
        inArray(registration.participantProfileId, [...visible.keys()]),
        eq(registration.route, "individual")
      )
    )
    .orderBy(desc(registration.createdAt), desc(registration.id));
  const ownsHeld = rows.some(
    (row) => row.ownerKind === "self" && row.status === "pending_guardian"
  );
  const nowAdult =
    ownsHeld &&
    (await ownProfileOf(ctx.db, ctx, userId, ctx.clock.now())) === "adult";
  return rows.map((row) => {
    const { whose, pays } = visible.get(row.profileId)!;
    const canContinue =
      row.status === "pending_guardian" && row.ownerKind === "self" && nowAdult;
    return {
      registrationId: row.registrationId,
      whose,
      participantName: row.participantName,
      competition: { name: row.competitionName, slug: row.competitionSlug },
      route: row.route,
      status: row.status,
      participantCode: row.participantCode ?? "",
      registrationNumber: row.registrationNumber,
      amountDue:
        pays &&
        (row.status === "pending_payment" || canContinue) &&
        row.fee !== null
          ? { amountMinor: row.fee, currency: "INR" }
          : null,
      childId: whose === "child" ? row.profileId : null,
      heldFor:
        row.status !== "pending_guardian" || canContinue
          ? null
          : row.ownerKind === "guardian"
            ? "consent"
            : "guardian",
      createdAt: row.createdAt,
    };
  });
}

/**
 * Whether the signed-in member has any registration to see: the header's
 * "My competitions" link asks on every page they open, so it reads one row,
 * not the dashboard.
 */
export async function hasMyRegistrations(
  ctx: UseCaseContext
): Promise<boolean> {
  await authorize(ctx, "registration.self.list");
  const userId = signedInUserId(ctx, "hasMyRegistrations");
  const visible = await visibleProfiles(ctx.db, userId);
  if (visible.size === 0) return false;
  const [found] = await ctx.db
    .select({ id: registration.id })
    .from(registration)
    .where(
      and(
        inArray(registration.participantProfileId, [...visible.keys()]),
        eq(registration.route, "individual")
      )
    )
    .limit(1);
  return found !== undefined;
}
