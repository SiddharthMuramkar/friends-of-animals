import { and, eq } from "drizzle-orm";
import { recordAudit } from "../../audit/record";
import { consentEvent, socialExport } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import type { Role } from "../../access/domain/roles";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";

/** Withdraw only rows based on a grant of the same purpose, subject,
 * competition and document that precedes this exact persisted withdrawal.
 * Replaying a delayed withdrawal must not remove a new explicitly queued grant. */
export async function withdrawSocialExportConsent(
  deps: OutboxDeps,
  { payload }: Delivery<"consent.withdrawn">
) {
  if (
    !payload.competitionId ||
    !["social_media", "public_display"].includes(payload.purpose)
  )
    return;
  const competitionId = payload.competitionId;
  const grantColumn =
    payload.purpose === "social_media"
      ? socialExport.socialConsentEventId
      : socialExport.galleryConsentEventId;
  await deps.db.transaction(async (tx) => {
    const [withdrawal] = await tx
      .select()
      .from(consentEvent)
      .where(
        and(
          eq(consentEvent.id, payload.consentEventId),
          eq(consentEvent.action, "withdrawn"),
          eq(consentEvent.subjectType, payload.subjectType),
          eq(consentEvent.subjectId, payload.subjectId),
          eq(consentEvent.competitionId, competitionId),
          eq(consentEvent.documentId, payload.documentId),
          eq(consentEvent.purpose, payload.purpose)
        )
      );
    if (!withdrawal) return;
    const rows = await tx
      .select({ row: socialExport, grant: consentEvent })
      .from(socialExport)
      .innerJoin(consentEvent, eq(grantColumn, consentEvent.id))
      .where(
        and(
          eq(consentEvent.subjectType, payload.subjectType),
          eq(consentEvent.subjectId, payload.subjectId),
          eq(consentEvent.competitionId, competitionId),
          eq(consentEvent.documentId, payload.documentId),
          eq(consentEvent.purpose, payload.purpose),
          eq(consentEvent.action, "given")
        )
      )
      .for("update", { of: socialExport });
    for (const { row, grant } of rows) {
      const afterGrant =
        payload.subjectType === "participant_profile"
          ? withdrawal.id > grant.id
          : withdrawal.occurredAt > grant.occurredAt ||
            (+withdrawal.occurredAt === +grant.occurredAt &&
              withdrawal.id > grant.id);
      if (!afterGrant) continue;
      await tx.delete(socialExport).where(eq(socialExport.id, row.id));
      await recordAudit(
        tx,
        { ...deps, actor: { kind: "system", process: "worker" } },
        {
          action: "social_export.withdrawn",
          entity: { type: "social_export", id: row.id },
          before: { status: row.status },
          after: { consentEventId: withdrawal.id },
          actorRole: null,
        }
      );
    }
  });
}

/** Moderation retires the export as part of the gallery's transaction; a
 * later review/publish must never resurrect an old caption or posted status.
 * Caller holds the gallery row lock, matching the export lock order. */
export async function retireHiddenGalleryExport(
  ctx: Pick<UseCaseContext, "db" | "clock" | "actor">,
  itemId: string,
  role: Role | null
) {
  const [row] = await ctx.db
    .select()
    .from(socialExport)
    .where(eq(socialExport.galleryItemId, itemId))
    .for("update");
  if (!row) return;
  await ctx.db.delete(socialExport).where(eq(socialExport.id, row.id));
  await recordAudit(ctx.db, ctx, {
    action: "social_export.retired",
    entity: { type: "social_export", id: row.id },
    before: { status: row.status },
    after: { reason: "gallery_hidden" },
    actorRole: role,
  });
}
