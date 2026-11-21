// Message templates (#69): content managers read and edit the wording of
// each message without a deploy.
//
//   listMessageTemplates()                → every key, its channels, its events
//   getMessageTemplate({ key })           → each channel's wording
//   updateMessageTemplate({ key, channel, subject?, body, dltTemplateId?,
//                           version? })   → the next version, audited
//
// An edit is checked by reviseTemplate (./domain/revision.ts): placeholders
// must be among the template's declared variables, and new SMS wording
// clears its DLT id. Each saved change is one audit entry with the wording
// before and after.

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../access/can";
import { recordAudit } from "../audit";
import { messageRoute, messageTemplate, user } from "../db/schema";
import { invalidInput, type InvalidInput } from "../input";
import type { UseCaseContext } from "../use-cases";
import { MESSAGE_CHANNELS, type MessageChannel } from "./domain/channels";
import {
  reviseTemplate,
  type RevisionProblem,
  type TemplateVersion,
} from "./domain/revision";

/** Every template is in this locale until a second one arrives. */
export const DEFAULT_LOCALE = "en-IN";

export type TemplateSummary = {
  channel: MessageChannel;
  version: number;
  dltTemplateId: string | null;
  updatedAt: Date;
};

export type TemplateListItem = {
  key: string;
  /** The event types whose routes send it, enabled or not. */
  events: string[];
  /** Email, SMS, in-app: those the key has. */
  channels: TemplateSummary[];
};

export type TemplateView = TemplateSummary & {
  subject: string | null;
  body: string;
  variables: string[];
  updatedBy: { id: string; name: string } | null;
};

export type MessageTemplateDetail = {
  key: string;
  events: string[];
  channels: TemplateView[];
};

export type GetMessageTemplateResult =
  | { ok: true; template: MessageTemplateDetail }
  | { ok: false; error: "not_found" };

const updateInput = z.object({
  key: z.string().min(1).max(100),
  channel: z.enum(MESSAGE_CHANNELS),
  subject: z.string().max(1_000).nullish(),
  body: z.string().max(20_000),
  dltTemplateId: z.string().max(100).nullish(),
  /** The version the editor started from; a newer one answers `stale`. */
  version: z.number().int().positive().optional(),
});

export type UpdateMessageTemplateInput = z.input<typeof updateInput>;

export type UpdateMessageTemplateResult =
  | { ok: true; template: TemplateView }
  | InvalidInput
  | { ok: false; error: "not_found" | "stale" }
  | { ok: false; error: "invalid_template"; problems: RevisionProblem[] };

const templateColumns = {
  id: messageTemplate.id,
  key: messageTemplate.key,
  channel: messageTemplate.channel,
  subject: messageTemplate.subject,
  body: messageTemplate.body,
  variables: messageTemplate.variables,
  dltTemplateId: messageTemplate.dltTemplateId,
  version: messageTemplate.version,
  updatedAt: messageTemplate.updatedAt,
  updatedById: user.id,
  updatedByName: user.name,
};

type TemplateRow = {
  channel: MessageChannel;
  subject: string | null;
  body: string;
  variables: string[];
  dltTemplateId: string | null;
  version: number;
  updatedAt: Date;
  updatedById: string | null;
  updatedByName: string | null;
};

function viewOf(row: TemplateRow): TemplateView {
  return {
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    variables: row.variables,
    dltTemplateId: row.dltTemplateId,
    version: row.version,
    updatedAt: row.updatedAt,
    updatedBy:
      row.updatedById === null || row.updatedByName === null
        ? null
        : { id: row.updatedById, name: row.updatedByName },
  };
}

async function eventsByKey(
  ctx: UseCaseContext
): Promise<Map<string, string[]>> {
  const routes = await ctx.db
    .selectDistinct({
      templateKey: messageRoute.templateKey,
      eventType: messageRoute.eventType,
    })
    .from(messageRoute)
    .orderBy(asc(messageRoute.eventType));
  const events = new Map<string, string[]>();
  for (const route of routes) {
    events.set(route.templateKey, [
      ...(events.get(route.templateKey) ?? []),
      route.eventType,
    ]);
  }
  return events;
}

export async function listMessageTemplates(
  ctx: UseCaseContext
): Promise<TemplateListItem[]> {
  await authorize(ctx, "message_template.view");
  const rows = await ctx.db
    .select({
      key: messageTemplate.key,
      channel: messageTemplate.channel,
      version: messageTemplate.version,
      dltTemplateId: messageTemplate.dltTemplateId,
      updatedAt: messageTemplate.updatedAt,
    })
    .from(messageTemplate)
    .where(eq(messageTemplate.locale, DEFAULT_LOCALE))
    // The enum's order: email, sms, in_app.
    .orderBy(asc(messageTemplate.key), asc(messageTemplate.channel));
  const events = await eventsByKey(ctx);
  const byKey = new Map<string, TemplateListItem>();
  for (const { key, ...summary } of rows) {
    const item = byKey.get(key) ?? {
      key,
      events: events.get(key) ?? [],
      channels: [],
    };
    item.channels.push(summary);
    byKey.set(key, item);
  }
  return [...byKey.values()];
}

export async function getMessageTemplate(
  ctx: UseCaseContext,
  input: { key: string }
): Promise<GetMessageTemplateResult> {
  await authorize(ctx, "message_template.view");
  const key = typeof input?.key === "string" ? input.key : "";
  const rows = await ctx.db
    .select(templateColumns)
    .from(messageTemplate)
    .leftJoin(user, eq(user.id, messageTemplate.updatedByUserId))
    .where(
      and(
        eq(messageTemplate.key, key),
        eq(messageTemplate.locale, DEFAULT_LOCALE)
      )
    )
    .orderBy(asc(messageTemplate.channel));
  if (rows.length === 0) return { ok: false, error: "not_found" };
  const events = await eventsByKey(ctx);
  return {
    ok: true,
    template: {
      key,
      events: events.get(key) ?? [],
      channels: rows.map(viewOf),
    },
  };
}

/** What the audit log keeps of a version: its wording, never a person. */
function audited(key: string, version: TemplateVersion) {
  return {
    key,
    channel: version.channel,
    version: version.version,
    subject: version.subject,
    body: version.body,
    dltTemplateId: version.dltTemplateId,
  };
}

export async function updateMessageTemplate(
  ctx: UseCaseContext,
  input: UpdateMessageTemplateInput
): Promise<UpdateMessageTemplateResult> {
  const { role } = await authorize(ctx, "message_template.edit");
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const editorId = ctx.actor.userId;
  const parsed = updateInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { key, channel, version, ...edit } = parsed.data;

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(messageTemplate)
      .where(
        and(
          eq(messageTemplate.key, key),
          eq(messageTemplate.channel, channel),
          eq(messageTemplate.locale, DEFAULT_LOCALE)
        )
      )
      .for("update");
    if (!row) return { ok: false, error: "not_found" } as const;
    if (version !== undefined && version !== row.version) {
      return { ok: false, error: "stale" } as const;
    }

    const revision = reviseTemplate(row, edit);
    if (!revision.ok) {
      return {
        ok: false,
        error: "invalid_template",
        problems: revision.problems,
      } as const;
    }
    if (!revision.changed) {
      return {
        ok: true,
        template: viewOf({ ...row, updatedById: null, updatedByName: null }),
      } as const;
    }

    const { next } = revision;
    const now = ctx.clock.now();
    await tx
      .update(messageTemplate)
      .set({
        subject: next.subject,
        body: next.body,
        dltTemplateId: next.dltTemplateId,
        version: next.version,
        updatedByUserId: editorId,
        updatedAt: now,
      })
      .where(eq(messageTemplate.id, row.id));
    await recordAudit(tx, ctx, {
      action: "message_template.updated",
      entity: { type: "message_template", id: row.id },
      before: audited(key, row),
      after: audited(key, next),
      actorRole: role,
    });
    const [editor] = await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, editorId));
    return {
      ok: true,
      template: viewOf({
        ...next,
        variables: [...next.variables],
        updatedAt: now,
        updatedById: editorId,
        updatedByName: editor?.name ?? null,
      }),
    } as const;
  });
}
