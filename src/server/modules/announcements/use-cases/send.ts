// sendAnnouncement({ id, revision }): a manager sends a reviewed draft (#84). In
// one transaction it marks the announcement sent (when, by whom, and how
// many people the plan reaches now), writes the audit row (the counts
// only, no recipient) and emits competition.announcement_sent with ids
// only. The worker then plans the audience again and sends (../fan-out.ts):
// a registration confirmed in between is told too, and the fan-out's
// deliveries say who actually received it. A sent announcement is never
// sent again.

import { and, eq } from "drizzle-orm";

import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { announcement } from "../../../db/schema";
import { emit } from "../../../outbox/emit";
import type { UseCaseContext } from "../../../use-cases";
import { loadAnnouncementDeliveryPlan } from "../delivery-plan";
import type { AudiencePlan } from "../domain/audience";
import { canMoveAnnouncement } from "../domain/status";
import {
  announcementScope,
  loadAnnouncement,
  viewOf,
  type AnnouncementTarget,
  type AnnouncementView,
} from "./drafts";

export type SendAnnouncementResult =
  | { ok: true; announcement: AnnouncementView; counts: AudiencePlan["counts"] }
  | {
      ok: false;
      error:
        | "not_found"
        | "announcement_already_sent"
        | "announcement_draft_changed";
    };

export type SendAnnouncementInput = AnnouncementTarget & { revision: number };

export async function sendAnnouncement(
  ctx: UseCaseContext,
  input: SendAnnouncementInput
): Promise<SendAnnouncementResult> {
  const { role } = await authorize(
    ctx,
    "announcement.manage",
    await announcementScope(ctx.db, input)
  );
  const smsEnabled = await ctx.settings.get("sms.enabled");

  return ctx.db.transaction(async (tx) => {
    const row = await loadAnnouncement(tx, input, "update");
    if (!row) return { ok: false, error: "not_found" } as const;
    if (!canMoveAnnouncement(row.status, "sent")) {
      return { ok: false, error: "announcement_already_sent" } as const;
    }
    if (row.revision !== input.revision) {
      return { ok: false, error: "announcement_draft_changed" } as const;
    }
    const now = ctx.clock.now();
    const { counts } = await loadAnnouncementDeliveryPlan(
      { ...ctx, db: tx },
      row.competitionId,
      now,
      smsEnabled
    );
    const [sent] = await tx
      .update(announcement)
      .set({
        status: "sent",
        sentAt: now,
        sentBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        recipientCount: counts.recipients,
        updatedAt: now,
      })
      .where(and(eq(announcement.id, row.id), eq(announcement.status, "draft")))
      .returning();
    await recordAudit(tx, ctx, {
      action: "announcement.sent",
      entity: { type: "announcement", id: row.id },
      before: { status: "draft" },
      after: { status: "sent", counts },
      actorRole: role,
    });
    await emit(tx, ctx.clock, {
      type: "competition.announcement_sent",
      aggregate: { type: "announcement", id: row.id },
      payload: { announcementId: row.id, competitionId: row.competitionId },
    });
    return {
      ok: true,
      announcement: viewOf(ctx.cipher, sent!),
      counts,
    } as const;
  });
}
