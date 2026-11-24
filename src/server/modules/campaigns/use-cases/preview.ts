// previewCampaign({ id }) and previewSegment({ segment }) (#126): how many
// people a segment holds now, and the message as a recipient would read it,
// before anything is sent. The counts come from the same plan the send
// queues (../load-audience.ts, ../domain/audience.ts): only people with
// current consent count as recipients.

import { z } from "zod";

import { WITHDRAWAL_PREFIX } from "../../../../lib/app-routes";
import { authorize } from "../../../access/can";
import type { AppDb } from "../../../db/app-db";
import type { UseCaseContext } from "../../../use-cases";
import { planAudience, type AudienceCounts } from "../domain/audience";
import {
  segmentDefinitionSchema,
  type SegmentDefinition,
} from "../domain/segment";
import { loadCandidates } from "../load-audience";
import { campaignTemplates, campaignValues, renderCampaign } from "../render";
import { loadCampaign, viewOf, type CampaignView } from "./drafts";
import { deliveryCounts, type DeliveryCounts } from "../delivery-counts";

export type CampaignPreview = {
  campaign: CampaignView;
  /** Now for a draft; what the plan held when it was sent otherwise. */
  counts: AudienceCounts;
  /** How a sent campaign's messages stand; null for a draft. */
  delivered: DeliveryCounts | null;
  email: { subject: string; body: string };
  inApp: { subject: string; body: string };
};

export type PreviewCampaignResult =
  | ({ ok: true } & CampaignPreview)
  | { ok: false; error: "not_found" };

export type PreviewSegmentResult =
  | { ok: true; counts: AudienceCounts }
  | { ok: false; error: "invalid_input"; fields: string[] };

/** The plan for `segment` as the database stands. */
export async function planSegment(db: AppDb, segment: SegmentDefinition) {
  return planAudience(segment, await loadCandidates(db));
}

export async function previewCampaign(
  ctx: UseCaseContext,
  input: { id: string }
): Promise<PreviewCampaignResult> {
  await authorize(ctx, "campaign.manage");
  const id = z.uuid().safeParse(input?.id);
  if (!id.success) return { ok: false, error: "not_found" };
  const row = await loadCampaign(ctx.db, id.data);
  if (!row) return { ok: false, error: "not_found" };
  const templates = await campaignTemplates(ctx.db);
  // A sample recipient: the preview shows where their name and link go.
  const values = campaignValues(row, {
    name: "{{recipient.name}}",
    withdrawalUrl: `${new URL(WITHDRAWAL_PREFIX, ctx.auth.baseUrl).href}/…`,
  });
  const counts =
    row.plannedCounts ?? (await planSegment(ctx.db, row.segment)).counts;
  return {
    ok: true,
    campaign: viewOf(row),
    counts,
    delivered:
      row.status === "draft" ? null : await deliveryCounts(ctx.db, row.id),
    email: renderCampaign(templates, "email", values),
    inApp: renderCampaign(templates, "in_app", values),
  };
}

export async function previewSegment(
  ctx: UseCaseContext,
  input: { segment: unknown }
): Promise<PreviewSegmentResult> {
  await authorize(ctx, "campaign.manage");
  const parsed = segmentDefinitionSchema.safeParse(input?.segment);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input", fields: ["segment"] };
  }
  const { counts } = await planSegment(ctx.db, parsed.data);
  return { ok: true, counts };
}
