import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import {
  competition,
  competitionInvitation,
  participantProfile,
  guardian,
  guardianLink,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import type { EventOf } from "../../outbox/events";
import { readSetting } from "../settings/read";
import { lockProfileSubject, lockUserSubject } from "../consent/repository";
import {
  INVITATION_ACTIONS,
  actionDestination,
  offeredActions,
  type InvitationAction,
} from "./actions";
import { verifiedLink } from "../guardians/child-access";
import { currentRecipient } from "./eligibility";
import { backfillPilotInvitations, queuePublishedInvitations } from "./queue";

async function myCompetitionInvitations(ctx: UseCaseContext) {
  await authorize(ctx, "competition_invitation.read");
  if (
    ctx.actor.kind !== "user" ||
    !(await readSetting(ctx.db, "invitations.enabled"))
  )
    return [];
  const rows = await ctx.db
    .select({
      row: competitionInvitation,
      name: competition.name,
      participantName: participantProfile.fullName,
    })
    .from(competitionInvitation)
    .innerJoin(
      competition,
      eq(competition.id, competitionInvitation.competitionId)
    )
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, competitionInvitation.participantProfileId)
    )
    .where(
      and(
        eq(competitionInvitation.recipientUserId, ctx.actor.userId),
        eq(competitionInvitation.status, "sent")
      )
    )
    .orderBy(
      desc(competitionInvitation.createdAt),
      desc(competitionInvitation.id)
    );
  const minimum = await readSetting(ctx.db, "volunteers.minAgeYears");
  const invitations = [];
  for (const { row, name, participantName } of rows) {
    const recipient = await currentRecipient(ctx, row);
    if (!recipient) continue;
    invitations.push({
      id: row.id,
      competitionId: row.competitionId,
      competitionName: name,
      participantName,
      relation: recipient.relation,
      acceptedActions: row.acceptedActions,
      actions: offeredActions(recipient, minimum),
    });
  }
  return invitations;
}

async function acceptCompetitionInvitation(
  ctx: UseCaseContext,
  input: { invitationId: string; action: InvitationAction }
) {
  const { role } = await authorize(ctx, "competition_invitation.accept");
  const parsed = z
    .strictObject({
      invitationId: z.uuid(),
      action: z.enum(INVITATION_ACTIONS),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" } as const;
  const actor = ctx.actor;
  if (actor.kind !== "user")
    return { ok: false, error: "unavailable" } as const;
  return ctx.db.transaction(async (db) => {
    const predicate = and(
      eq(competitionInvitation.id, parsed.data.invitationId),
      eq(competitionInvitation.recipientUserId, actor.userId),
      eq(competitionInvitation.status, "sent")
    );
    const [initial] = await db
      .select({ profileId: competitionInvitation.participantProfileId })
      .from(competitionInvitation)
      .where(predicate);
    if (!initial) return { ok: false, error: "unavailable" } as const;
    await lockProfileSubject(db, initial.profileId);
    await lockUserSubject(db, actor.userId);
    const [row] = await db
      .select()
      .from(competitionInvitation)
      .where(predicate)
      .for("update");
    if (!row) return { ok: false, error: "unavailable" } as const;
    // Hold any guardian link through the choice; revocation cannot race it.
    await db
      .select({ id: guardianLink.id })
      .from(guardianLink)
      .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
      .where(
        and(
          eq(guardianLink.participantProfileId, row.participantProfileId),
          eq(guardian.userId, actor.userId),
          verifiedLink()
        )
      )
      .for("no key update", { of: guardianLink });
    const recipient = await currentRecipient({ ...ctx, db }, row);
    if (!recipient) return { ok: false, error: "unavailable" } as const;
    const action = parsed.data.action;
    const minAge = await readSetting(db, "volunteers.minAgeYears");
    if (!offeredActions(recipient, minAge).includes(action))
      return { ok: false, error: "action_not_offered" } as const;
    if (!row.acceptedActions.includes(action)) {
      await db
        .update(competitionInvitation)
        .set({ acceptedActions: [...row.acceptedActions, action] })
        .where(eq(competitionInvitation.id, row.id));
      await recordAudit(db, ctx, {
        action: "competition_invitation.accepted",
        entity: { type: "competition_invitation", id: row.id },
        actorRole: role,
        before: null,
        after: { action },
      });
    }
    return {
      ok: true,
      destination: actionDestination(action, recipient),
    } as const;
  });
}

export const invitationsUseCases = (ctx: UseCaseContext) => ({
  queuePublishedInvitations: (input: EventOf<"results.published">["payload"]) =>
    queuePublishedInvitations(ctx, input),
  backfillPilotInvitations: (input: { competitionId: string }) =>
    backfillPilotInvitations(ctx, input),
  myCompetitionInvitations: () => myCompetitionInvitations(ctx),
  acceptCompetitionInvitation: (input: {
    invitationId: string;
    action: InvitationAction;
  }) => acceptCompetitionInvitation(ctx, input),
});
