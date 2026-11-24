// Announcement drafts (#84): a competition manager writes one for a
// competition, edits it until it is sent, and reads it back. Each use case
// checks `can()` first, for the competition the announcement belongs to.
//
//   createAnnouncement({ competitionId, content }) → a draft
//   updateAnnouncement({ id, content })            → replaces a draft's content
//   getAnnouncement({ id })                        → one announcement
//   listAnnouncements({ competitionId })           → the competition's, newest first

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { Resource } from "../../../access/domain/policy";
import { recordAudit } from "../../../audit/record";
import type { FieldCipher } from "../../../crypto/field-cipher";
import type { AppDb } from "../../../db/app-db";
import {
  announcement,
  competition,
  type AnnouncementRow,
} from "../../../db/schema";
import { HELP_CONTACTS_PURPOSE } from "../../../db/schema/announcements";
import { uuidv7 } from "../../../ids";
import type { InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import {
  announcementContentSchema,
  type AnnouncementContent,
  type AnnouncementContentInput,
} from "../domain/content";
import {
  isAnnouncementEditable,
  type AnnouncementStatus,
} from "../domain/status";

/** What the announcement use cases use. */
export type AnnouncementContext = Pick<
  UseCaseContext,
  "db" | "clock" | "actor" | "cipher"
>;

export type AnnouncementView = {
  id: string;
  competitionId: string;
  status: AnnouncementStatus;
  revision: number;
  content: AnnouncementContent;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  recipientCount: number | null;
};

export type AnnouncementSummary = {
  id: string;
  subject: string;
  status: AnnouncementStatus;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  recipientCount: number | null;
};

export type AnnouncementCompetition = {
  id: string;
  code: string;
  name: string;
};

type NotFound = { ok: false; error: "not_found" };

export type CreateAnnouncementResult =
  | { ok: true; announcement: AnnouncementView }
  | InvalidInput
  | NotFound;

export type UpdateAnnouncementResult =
  | { ok: true; announcement: AnnouncementView }
  | InvalidInput
  | NotFound
  | { ok: false; error: "announcement_not_editable" };

export type GetAnnouncementResult =
  | {
      ok: true;
      announcement: AnnouncementView;
      competition: AnnouncementCompetition;
    }
  | NotFound;

export type ListAnnouncementsResult =
  | {
      ok: true;
      competition: AnnouncementCompetition;
      announcements: AnnouncementSummary[];
    }
  | NotFound;

const NOT_FOUND = { ok: false, error: "not_found" } as const;

const announcementTarget = z.object({
  id: z.uuid(),
  competitionId: z.uuid().optional(),
});

export type AnnouncementTarget = z.infer<typeof announcementTarget>;

/** The scope a competition's announcements sit in, for `can()`. */
export function competitionScope(competitionId: unknown): Resource {
  const id = z.uuid().safeParse(competitionId);
  return id.success ? { scopes: [{ type: "competition", id: id.data }] } : {};
}

/** Authorize a scoped route before looking for the announcement on it. */
export async function announcementScope(
  db: AppDb,
  input: AnnouncementTarget
): Promise<Resource> {
  if (input?.competitionId !== undefined)
    return competitionScope(input.competitionId);
  const parsed = z.uuid().safeParse(input?.id);
  if (!parsed.success) return {};
  const [row] = await db
    .select({ competitionId: announcement.competitionId })
    .from(announcement)
    .where(eq(announcement.id, parsed.data));
  return row ? competitionScope(row.competitionId) : {};
}

/**
 * The content, or the fields at fault: a section's own name, or `sections`
 * when every section is empty.
 */
export function parseContent(
  content: unknown
): { ok: true; content: AnnouncementContent } | InvalidInput {
  const parsed = announcementContentSchema.safeParse(content);
  if (parsed.success) return { ok: true, content: parsed.data };
  const fields = new Set(
    parsed.error.issues.map((issue) =>
      issue.path.length === 0 ? "sections" : String(issue.path[0])
    )
  );
  return { ok: false, error: "invalid_input", fields: [...fields] };
}

function storedContent(cipher: FieldCipher, content: AnnouncementContent) {
  const { helpContacts, ...sections } = content;
  return {
    ...sections,
    helpContactsCiphertext:
      helpContacts === null
        ? null
        : cipher.encrypt(HELP_CONTACTS_PURPOSE, helpContacts),
  };
}

export function contentOf(
  cipher: FieldCipher,
  row: AnnouncementRow
): AnnouncementContent {
  return {
    subject: row.subject,
    eventAt: row.eventAt,
    confirmedTheme: row.confirmedTheme,
    permittedMaterials: row.permittedMaterials,
    duration: row.duration,
    submissionSteps: row.submissionSteps,
    physicalArtworkRequirements: row.physicalArtworkRequirements,
    deadlines: row.deadlines,
    helpContacts:
      row.helpContactsCiphertext === null
        ? null
        : cipher.decrypt(HELP_CONTACTS_PURPOSE, row.helpContactsCiphertext),
    message: row.message,
  };
}

export function viewOf(
  cipher: FieldCipher,
  row: AnnouncementRow
): AnnouncementView {
  return {
    id: row.id,
    competitionId: row.competitionId,
    status: row.status,
    revision: row.revision,
    content: contentOf(cipher, row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sentAt: row.sentAt,
    recipientCount: row.recipientCount,
  };
}

export async function loadCompetition(
  db: AppDb,
  competitionId: string
): Promise<AnnouncementCompetition | null> {
  const [row] = await db
    .select({
      id: competition.id,
      code: competition.code,
      name: competition.name,
    })
    .from(competition)
    .where(eq(competition.id, competitionId));
  return row ?? null;
}

/** The announcement, locked for update inside a transaction when asked. */
export async function loadAnnouncement(
  db: AppDb,
  input: AnnouncementTarget,
  lock?: "update"
): Promise<AnnouncementRow | null> {
  const parsed = announcementTarget.safeParse(input);
  if (!parsed.success) return null;
  const { id, competitionId } = parsed.data;
  const query = db
    .select()
    .from(announcement)
    .where(
      and(
        eq(announcement.id, id),
        competitionId
          ? eq(announcement.competitionId, competitionId)
          : undefined
      )
    );
  const [row] = lock ? await query.for(lock) : await query;
  return row ?? null;
}

function actorUserId(ctx: AnnouncementContext): string | null {
  return ctx.actor.kind === "user" ? ctx.actor.userId : null;
}

export async function createAnnouncement(
  ctx: AnnouncementContext,
  input: { competitionId: string; content: AnnouncementContentInput }
): Promise<CreateAnnouncementResult> {
  const { role } = await authorize(
    ctx,
    "announcement.manage",
    competitionScope(input?.competitionId)
  );
  const competitionId = z.uuid().safeParse(input?.competitionId);
  if (!competitionId.success) return NOT_FOUND;
  const parsed = parseContent(input?.content);
  if (!parsed.ok) return parsed;
  if (!(await loadCompetition(ctx.db, competitionId.data))) return NOT_FOUND;

  const now = ctx.clock.now();
  const id = uuidv7(now);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(announcement)
      .values({
        id,
        competitionId: competitionId.data,
        status: "draft",
        ...storedContent(ctx.cipher, parsed.content),
        createdBy: actorUserId(ctx),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: "announcement.created",
      entity: { type: "announcement", id },
      before: null,
      after: { status: "draft" },
      actorRole: role,
    });
    return { ok: true, announcement: viewOf(ctx.cipher, row!) } as const;
  });
}

export async function updateAnnouncement(
  ctx: AnnouncementContext,
  input: AnnouncementTarget & { content: AnnouncementContentInput }
): Promise<UpdateAnnouncementResult> {
  const { role } = await authorize(
    ctx,
    "announcement.manage",
    await announcementScope(ctx.db, input)
  );
  const parsed = parseContent(input?.content);
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const row = await loadAnnouncement(tx, input, "update");
    if (!row) return NOT_FOUND;
    if (!isAnnouncementEditable(row.status)) {
      return { ok: false, error: "announcement_not_editable" } as const;
    }
    if (!parsed.ok) return parsed;
    const [updated] = await tx
      .update(announcement)
      .set({
        ...storedContent(ctx.cipher, parsed.content),
        revision: row.revision + 1,
        updatedAt: now,
      })
      .where(and(eq(announcement.id, row.id), eq(announcement.status, "draft")))
      .returning();
    await recordAudit(tx, ctx, {
      action: "announcement.updated",
      entity: { type: "announcement", id: row.id },
      before: { status: row.status },
      after: { status: "draft" },
      actorRole: role,
    });
    return { ok: true, announcement: viewOf(ctx.cipher, updated!) } as const;
  });
}

export async function getAnnouncement(
  ctx: AnnouncementContext,
  input: AnnouncementTarget
): Promise<GetAnnouncementResult> {
  await authorize(
    ctx,
    "announcement.manage",
    await announcementScope(ctx.db, input)
  );
  const row = await loadAnnouncement(ctx.db, input);
  if (!row) return NOT_FOUND;
  const found = await loadCompetition(ctx.db, row.competitionId);
  if (!found) return NOT_FOUND;
  return {
    ok: true,
    announcement: viewOf(ctx.cipher, row),
    competition: found,
  };
}

export async function listAnnouncements(
  ctx: AnnouncementContext,
  input: { competitionId: string }
): Promise<ListAnnouncementsResult> {
  await authorize(
    ctx,
    "announcement.manage",
    competitionScope(input?.competitionId)
  );
  const competitionId = z.uuid().safeParse(input?.competitionId);
  if (!competitionId.success) return NOT_FOUND;
  const found = await loadCompetition(ctx.db, competitionId.data);
  if (!found) return NOT_FOUND;
  const rows = await ctx.db
    .select({
      id: announcement.id,
      subject: announcement.subject,
      status: announcement.status,
      createdAt: announcement.createdAt,
      updatedAt: announcement.updatedAt,
      sentAt: announcement.sentAt,
      recipientCount: announcement.recipientCount,
    })
    .from(announcement)
    .where(eq(announcement.competitionId, competitionId.data))
    .orderBy(desc(announcement.createdAt), desc(announcement.id));
  return { ok: true, competition: found, announcements: rows };
}
