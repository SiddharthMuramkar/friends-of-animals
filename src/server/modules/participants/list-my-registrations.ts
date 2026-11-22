// listMyRegistrations() (#78): the participant dashboard's read model. The
// signed-in member's own registrations, newest first: which competition,
// its status, their Participant ID, the registration number once
// confirmed, and what is still owed while it waits for payment. Only the
// profile they own is read, so nobody else's registrations ever show.
// Entries, results and certificates join it with later tickets.

import { and, desc, eq } from "drizzle-orm";

import { authorize } from "../../access/can";
import {
  competition,
  competitionFee,
  participantProfile,
  registration,
} from "../../db/schema";
import type { Money } from "../../ports/payment-gateway";
import type { UseCaseContext } from "../../use-cases";
import type {
  RegistrationRoute,
  ParticipantOwnerKind,
} from "../registration/domain/participant";
import type { RegistrationStatus } from "../registration/domain/registration-status";

export type MyRegistration = {
  registrationId: string;
  competition: { name: string; slug: string };
  route: RegistrationRoute;
  status: RegistrationStatus;
  participantCode: string;
  /** Given once the registration is confirmed. */
  registrationNumber: string | null;
  /** The individual fee still owed; null once nothing is owed. */
  amountDue: Money | null;
  createdAt: Date;
};

const OWN: ParticipantOwnerKind = "self";

export async function listMyRegistrations(
  ctx: UseCaseContext
): Promise<MyRegistration[]> {
  await authorize(ctx, "registration.self.list");
  if (ctx.actor.kind !== "user") {
    throw new Error("listMyRegistrations needs a signed-in user");
  }
  const rows = await ctx.db
    .select({
      registrationId: registration.id,
      competitionName: competition.name,
      competitionSlug: competition.slug,
      route: registration.route,
      status: registration.status,
      participantCode: participantProfile.participantCode,
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
        eq(participantProfile.ownerUserId, ctx.actor.userId),
        eq(participantProfile.ownerKind, OWN)
      )
    )
    .orderBy(desc(registration.createdAt), desc(registration.id));
  return rows.map((row) => ({
    registrationId: row.registrationId,
    competition: { name: row.competitionName, slug: row.competitionSlug },
    route: row.route,
    status: row.status,
    participantCode: row.participantCode ?? "",
    registrationNumber: row.registrationNumber,
    amountDue:
      row.status === "pending_payment" && row.fee !== null
        ? { amountMinor: row.fee, currency: "INR" }
        : null,
    createdAt: row.createdAt,
  }));
}
