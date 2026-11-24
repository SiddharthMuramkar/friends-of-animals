// Campaign drafts (#126): a community manager writes one for a segment,
// edits it until it is sent, and reads it back.
//
//   createCampaign({ subject, body, segment })            → a draft
//   updateCampaign({ id, revision, subject, body, segment }) → the next revision
//   getCampaign({ id })                                   → one campaign
//   listCampaigns()                                       → every campaign, newest first

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import type { AppDb } from "../../../db/app-db";
import { campaign, type CampaignRow } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { AudienceCounts } from "../domain/audience";
import { campaignContentSchema, type CampaignStatus } from "../domain/campaign";
import {
  segmentDefinitionSchema,
  type SegmentDefinition,
} from "../domain/segment";

export type CampaignView = {
  id: string;
  status: CampaignStatus;
  revision: number;
  subject: string;
  body: string;
  segment: SegmentDefinition;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  /** What the plan held when it was sent; null for a draft. */
  plannedCounts: AudienceCounts | null;
  completedAt: Date | null;
};

export type CampaignSummary = Pick<
  CampaignView,
  "id" | "status" | "subject" | "createdAt" | "sentAt" | "completedAt"
> & { recipients: number | null };

type NotFound = { ok: false; error: "not_found" };
const NOT_FOUND = { ok: false, error: "not_found" } as const;

export type CreateCampaignResult =
  | { ok: true; campaign: CampaignView }
  | InvalidInput;

export type UpdateCampaignResult =
  | { ok: true; campaign: CampaignView }
  | InvalidInput
  | NotFound
  | { ok: false; error: "campaign_not_editable" | "campaign_draft_changed" };

export type GetCampaignResult = { ok: true; campaign: CampaignView } | NotFound;

export type ListCampaignsResult = { ok: true; campaigns: CampaignSummary[] };

const draftInput = z.object({
  subject: z.unknown(),
  body: z.unknown(),
  segment: segmentDefinitionSchema,
});

const target = z.object({ id: z.uuid() });

export type CampaignDraftInput = {
  subject: string;
  body: string;
  segment: SegmentDefinition;
};

export type CampaignTarget = { id: string };

/** Parses a draft's wording and segment, naming each field at fault. */
function parseDraft(input: unknown) {
  const content = campaignContentSchema.safeParse({
    subject: (input as { subject?: unknown } | null)?.subject,
    body: (input as { body?: unknown } | null)?.body,
  });
  const rest = draftInput.safeParse(input);
  if (content.success && rest.success) {
    return {
      ok: true,
      value: { ...content.data, segment: rest.data.segment },
    } as const;
  }
  const fields = new Set<string>();
  for (const issue of content.error?.issues ?? []) {
    fields.add(String(issue.path[0]));
  }
  for (const issue of rest.error?.issues ?? []) {
    const field = String(issue.path[0]);
    if (field !== "subject" && field !== "body") fields.add(field);
  }
  const result: InvalidInput = {
    ok: false,
    error: "invalid_input",
    fields: [...fields],
  };
  return { ok: false, result } as const;
}

export function viewOf(row: CampaignRow): CampaignView {
  return {
    id: row.id,
    status: row.status,
    revision: row.revision,
    subject: row.subject,
    body: row.body,
    segment: row.segment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sentAt: row.sentAt,
    plannedCounts: row.plannedCounts,
    completedAt: row.completedAt,
  };
}

function actingUser(ctx: Pick<UseCaseContext, "actor">): string | null {
  return ctx.actor.kind === "user" ? ctx.actor.userId : null;
}

/** One campaign, locked for the rest of the transaction when asked. */
export async function loadCampaign(
  db: AppDb,
  id: string,
  lock?: "update"
): Promise<CampaignRow | null> {
  const query = db.select().from(campaign).where(eq(campaign.id, id));
  const [row] = await (lock ? query.for(lock) : query);
  return row ?? null;
}

export async function createCampaign(
  ctx: UseCaseContext,
  input: CampaignDraftInput
): Promise<CreateCampaignResult> {
  const { role } = await authorize(ctx, "campaign.manage");
  const parsed = parseDraft(input);
  if (!parsed.ok) return parsed.result;
  const now = ctx.clock.now();
  const id = uuidv7(now);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(campaign)
      .values({
        id,
        ...parsed.value,
        createdBy: actingUser(ctx),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: "campaign.created",
      entity: { type: "campaign", id },
      before: null,
      after: { status: "draft", segment: parsed.value.segment },
      actorRole: role,
    });
    return { ok: true, campaign: viewOf(row!) } as const;
  });
}

export async function updateCampaign(
  ctx: UseCaseContext,
  input: CampaignTarget & { revision: number } & CampaignDraftInput
): Promise<UpdateCampaignResult> {
  const { role } = await authorize(ctx, "campaign.manage");
  const which = target
    .extend({ revision: z.int().positive() })
    .safeParse(input);
  if (!which.success) return invalidInput(which.error);
  const parsed = parseDraft(input);
  if (!parsed.ok) return parsed.result;
  return ctx.db.transaction(async (tx) => {
    const row = await loadCampaign(tx, which.data.id, "update");
    if (!row) return NOT_FOUND;
    if (row.status !== "draft") {
      return { ok: false, error: "campaign_not_editable" } as const;
    }
    if (row.revision !== which.data.revision) {
      return { ok: false, error: "campaign_draft_changed" } as const;
    }
    const [updated] = await tx
      .update(campaign)
      .set({
        ...parsed.value,
        revision: row.revision + 1,
        updatedAt: ctx.clock.now(),
      })
      .where(and(eq(campaign.id, row.id), eq(campaign.status, "draft")))
      .returning();
    await recordAudit(tx, ctx, {
      action: "campaign.updated",
      entity: { type: "campaign", id: row.id },
      before: { revision: row.revision, segment: row.segment },
      after: { revision: row.revision + 1, segment: parsed.value.segment },
      actorRole: role,
    });
    return { ok: true, campaign: viewOf(updated!) } as const;
  });
}

export async function getCampaign(
  ctx: UseCaseContext,
  input: CampaignTarget
): Promise<GetCampaignResult> {
  await authorize(ctx, "campaign.manage");
  const parsed = target.safeParse(input);
  if (!parsed.success) return NOT_FOUND;
  const row = await loadCampaign(ctx.db, parsed.data.id);
  return row ? { ok: true, campaign: viewOf(row) } : NOT_FOUND;
}

export async function listCampaigns(
  ctx: UseCaseContext
): Promise<ListCampaignsResult> {
  await authorize(ctx, "campaign.manage");
  const rows = await ctx.db
    .select()
    .from(campaign)
    .orderBy(desc(campaign.createdAt), desc(campaign.id));
  return {
    ok: true,
    campaigns: rows.map((row) => ({
      id: row.id,
      status: row.status,
      subject: row.subject,
      createdAt: row.createdAt,
      sentAt: row.sentAt,
      completedAt: row.completedAt,
      recipients: row.plannedCounts?.recipients ?? null,
    })),
  };
}
