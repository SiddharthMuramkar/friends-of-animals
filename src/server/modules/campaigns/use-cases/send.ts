// sendCampaign({ id, revision }) (#126): a community manager sends a
// reviewed draft. In one transaction it plans the segment as it stands
// (only people with current consent), saves one recipient row per person a
// message goes to, with the consents it rests on and its withdrawal link's
// hash, queues one outbox event per row, marks the campaign `sending` with
// who sent it, when and the counts, and audits the counts (never who). The
// worker then sends each message, checking its consent again first
// (../deliver.ts). A campaign is sent once.

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { campaign, campaignRecipient } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { emitBatch } from "../../../outbox/emit";
import type { UseCaseContext } from "../../../use-cases";
import type { AudienceCounts } from "../domain/audience";
import { canMoveCampaign } from "../domain/campaign";
import { withdrawalToken } from "../withdrawal-link";
import { loadCampaign, viewOf, type CampaignView } from "./drafts";
import { planSegment } from "./preview";

export type SendCampaignResult =
  | { ok: true; campaign: CampaignView; counts: AudienceCounts }
  | {
      ok: false;
      error:
        | "not_found"
        | "campaign_already_sent"
        | "campaign_draft_changed"
        | "segment_empty";
    };

/** Rows and events written per statement. */
const BATCH = 500;

const sendInput = z.object({ id: z.uuid(), revision: z.int().positive() });

export async function sendCampaign(
  ctx: UseCaseContext,
  input: { id: string; revision: number }
): Promise<SendCampaignResult> {
  const { role } = await authorize(ctx, "campaign.manage");
  const parsed = sendInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };

  return ctx.db.transaction(async (tx): Promise<SendCampaignResult> => {
    const row = await loadCampaign(tx, parsed.data.id, "update");
    if (!row) return { ok: false, error: "not_found" };
    if (!canMoveCampaign(row.status, "sending")) {
      return { ok: false, error: "campaign_already_sent" };
    }
    if (row.revision !== parsed.data.revision) {
      return { ok: false, error: "campaign_draft_changed" };
    }
    const { recipients, counts } = await planSegment(tx, row.segment);
    if (recipients.length === 0) return { ok: false, error: "segment_empty" };

    const now = ctx.clock.now();
    const rows = recipients.map((recipient) => {
      const id = uuidv7(now);
      return {
        id,
        campaignId: row.id,
        userId: recipient.userId,
        bases: recipient.bases,
        tokenHash: withdrawalToken(ctx.blindIndex, id).tokenHash,
        createdAt: now,
      };
    });
    for (let at = 0; at < rows.length; at += BATCH) {
      const batch = rows.slice(at, at + BATCH);
      await tx.insert(campaignRecipient).values(batch);
      await emitBatch(
        tx,
        ctx.clock,
        batch.map(({ id }) => ({
          type: "campaign.message_due" as const,
          aggregate: { type: "campaign_recipient" as const, id },
          payload: { campaignId: row.id, recipientId: id },
        }))
      );
    }
    const [sent] = await tx
      .update(campaign)
      .set({
        status: "sending",
        sentAt: now,
        sentBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        plannedCounts: counts,
        updatedAt: now,
      })
      .where(and(eq(campaign.id, row.id), eq(campaign.status, "draft")))
      .returning();
    await recordAudit(tx, ctx, {
      action: "campaign.sent",
      entity: { type: "campaign", id: row.id },
      before: { status: "draft" },
      after: { status: "sending", segment: row.segment, counts },
      actorRole: role,
    });
    return { ok: true, campaign: viewOf(sent!), counts };
  });
}
