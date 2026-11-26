import { and, asc, eq, inArray, notLike } from "drizzle-orm";
import { z } from "zod";
import { authorize, type PolicyContext } from "../../access/can";
import { recordAudit } from "../../audit/record";
import {
  competition,
  competitionInvitation,
  participantProfile,
  registration,
} from "../../db/schema";
import type { FieldCipher } from "../../crypto/field-cipher";
import { uuidv7 } from "../../ids";
import { emitBatch } from "../../outbox/emit";
import type { EventOf } from "../../outbox/events";
import { publishedRelease } from "../results/read-published";
import { readSetting } from "../settings/read";
import { invitationAudience } from "./audience";

type Context = PolicyContext & { cipher: FieldCipher };
type Publication = EventOf<"results.published">["payload"];

async function queue(ctx: Context, competitionId: string, event?: Publication) {
  return ctx.db.transaction(async (db) => {
    if (!(await readSetting(db, "invitations.enabled", { lock: "share" })))
      return { ok: false, error: "disabled" } as const;
    const [comp] = await db
      .select({ id: competition.id })
      .from(competition)
      .where(eq(competition.id, competitionId))
      .for("no key update");
    const release = comp && (await publishedRelease(db, competitionId));
    if (
      !release ||
      release.publishedAt > ctx.clock.now() ||
      (event &&
        (event.releaseId !== release.releaseId ||
          Date.parse(event.publishedAt) !== release.publishedAt.getTime()))
    )
      return { ok: false, error: "results_not_published" } as const;
    // Ordered profile locks also serialize backfills across competitions.
    const profiles = await db
      .select({ id: participantProfile.id })
      .from(registration)
      .innerJoin(
        participantProfile,
        eq(participantProfile.id, registration.participantProfileId)
      )
      .where(
        and(
          eq(registration.competitionId, competitionId),
          eq(registration.status, "confirmed"),
          notLike(participantProfile.identityHash, "erased:%")
        )
      )
      .orderBy(asc(participantProfile.id))
      .for("no key update", { of: participantProfile });
    const profileIds = profiles.map(({ id }) => id);
    const audience = await invitationAudience(
      { ...ctx, db },
      competitionId,
      profileIds
    );
    const existing = profileIds.length
      ? await db
          .select({ id: competitionInvitation.participantProfileId })
          .from(competitionInvitation)
          .where(
            and(
              inArray(competitionInvitation.participantProfileId, profileIds),
              event
                ? eq(competitionInvitation.competitionId, competitionId)
                : undefined
            )
          )
      : [];
    const already = new Set(existing.map(({ id }) => id));
    const now = ctx.clock.now();
    const rows = [...audience.values()]
      .filter((r) => !already.has(r.profileId))
      .map((r) => ({
        id: uuidv7(now),
        competitionId,
        releaseId: release.releaseId,
        participantProfileId: r.profileId,
        recipientUserId: r.userId,
        trigger: event
          ? ("results_published" as const)
          : ("pilot_backfill" as const),
        createdAt: now,
      }));
    let invited = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const written = await db
        .insert(competitionInvitation)
        .values(rows.slice(i, i + 500))
        .onConflictDoNothing({
          target: [
            competitionInvitation.competitionId,
            competitionInvitation.participantProfileId,
          ],
        })
        .returning({ id: competitionInvitation.id });
      invited += written.length;
      await emitBatch(
        db,
        ctx.clock,
        written.map(({ id }) => ({
          type: "competition_invitation.due",
          aggregate: { type: "competition_invitation", id },
          payload: { invitationId: id },
        }))
      );
    }
    return { ok: true, invited } as const;
  });
}

export async function queuePublishedInvitations(
  ctx: Context,
  event: Publication
) {
  await authorize(ctx, "competition_invitation.publish");
  if (!z.uuid().safeParse(event.competitionId).success)
    return { ok: false, error: "invalid_input" } as const;
  return queue(ctx, event.competitionId, event);
}

export async function backfillPilotInvitations(
  ctx: Context,
  { competitionId }: { competitionId: string }
) {
  const { role } = await authorize(ctx, "competition_invitation.backfill");
  if (!z.uuid().safeParse(competitionId).success)
    return { ok: false, error: "invalid_input" } as const;
  // No all-competition sweep. The owner chooses one already published pilot
  // after HR-58 sign-off and reaches this use case with fresh step-up.
  return ctx.db.transaction(async (db) => {
    const result = await queue({ ...ctx, db }, competitionId);
    if (result.ok)
      await recordAudit(db, ctx, {
        action: "competition_invitation.pilot_backfill",
        entity: { type: "competition", id: competitionId },
        actorRole: role,
        before: null,
        after: { invited: result.invited },
      });
    return result;
  });
}
