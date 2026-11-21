// The staff inbox (#113): list, read, assign, change status, add notes.
//
//   listContactInbox({ status?, team?, topic?, assignee? })
//   getContactMessage({ messageId })
//   assignContactMessage({ messageId, assigneeId })        audited
//   changeContactMessageStatus({ messageId, status, closeReason? })  audited
//   addContactNote({ messageId, body })                     audited
//
// The platform policy lets in the contact teams and the admin roles
// (./access-policy.ts). Which messages each sees is `inboxAccess`: a team
// member their teams' messages, staff and super admins all. A message
// outside the actor's teams is "not found", never "forbidden", so its
// existence doesn't leak. Audit entries hold the status, the assignee and
// the close reason, or the note's id: never what the sender or staff
// wrote.

import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import { grantsOf } from "../../access/grants";
import { recordAudit } from "../../audit";
import type { AppDb } from "../../db/app-db";
import {
  contactMessage,
  contactNote,
  user,
  userRole,
  type ContactMessage,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { UseCaseContext } from "../../use-cases";
import {
  CONTACT_TEAMS,
  CONTACT_TOPICS,
  inboxAccess,
  mayHandle,
  type ContactTeam,
  type ContactTopic,
  type InboxAccess,
} from "./domain/routing";
import {
  CONTACT_CLOSE_REASONS,
  CONTACT_MESSAGE_STATUSES,
  decideAssignment,
  decideStatusChange,
  type ContactCloseReason,
  type ContactMessageStatus,
} from "./domain/status";

export type Person = { id: string; name: string };

export type ContactInboxItem = {
  id: string;
  reference: string;
  topic: ContactTopic;
  team: ContactTeam;
  name: string;
  subject: string;
  status: ContactMessageStatus;
  assignee: Person | null;
  createdAt: Date;
};

export type ListContactInboxInput = {
  status?: string;
  team?: string;
  topic?: string;
  /** "me", "unassigned" or a user id. */
  assignee?: string;
};

export type ListContactInboxResult =
  | { ok: true; items: ContactInboxItem[] }
  | { ok: false; error: "invalid_input" };

export type ContactNoteView = {
  id: string;
  body: string;
  author: Person | null;
  createdAt: Date;
};

export type ContactMessageView = ContactInboxItem & {
  email: string;
  organisation: string | null;
  message: string;
  closeReason: ContactCloseReason | null;
  closedAt: Date | null;
  notes: ContactNoteView[];
  /** Who may be assigned: staff who handle the message's team. */
  assignableStaff: Person[];
};

export type GetContactMessageResult =
  | { ok: true; message: ContactMessageView }
  | { ok: false; error: "not_found" };

export type AssignContactMessageResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      error:
        | "not_found"
        | "invalid_input"
        | "message_closed"
        | "assignee_not_allowed";
    };

export type ChangeContactMessageStatusResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      error:
        | "not_found"
        | "invalid_input"
        | "transition_not_allowed"
        | "close_reason_required"
        | "close_reason_not_allowed";
    };

export type AddContactNoteResult =
  | { ok: true; noteId: string }
  | { ok: false; error: "not_found" | "invalid_input" };

/** Longest note, after trimming. */
export const CONTACT_NOTE_MAX = 5000;

/** The newest this many messages; older ones are found by filtering. */
const LIST_LIMIT = 200;

const listInput = z.object({
  status: z.enum(CONTACT_MESSAGE_STATUSES).optional(),
  team: z.enum(CONTACT_TEAMS).optional(),
  topic: z.enum(CONTACT_TOPICS).optional(),
  assignee: z
    .union([z.literal("me"), z.literal("unassigned"), z.uuid()])
    .optional(),
});

const messageId = z.uuid();

const assignInput = z.object({
  messageId,
  assigneeId: z.uuid().nullable(),
});

const statusInput = z.object({
  messageId,
  status: z.enum(CONTACT_MESSAGE_STATUSES),
  closeReason: z.enum(CONTACT_CLOSE_REASONS).optional(),
});

const noteInput = z.object({
  messageId,
  body: z.string().trim().min(1).max(CONTACT_NOTE_MAX),
});

/** The inbox's actor: who they are, the role that let them in, and what they see. */
type InboxActor = { userId: string; role: Role | null; access: InboxAccess };

async function inboxActor(
  ctx: UseCaseContext,
  action: "contact.inbox.view" | "contact.inbox.handle"
): Promise<InboxActor> {
  const { role } = await authorize(ctx, action);
  // The policy admits signed-in staff only.
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const access = inboxAccess(await grantsOf(ctx.db, ctx.actor.userId));
  return { userId: ctx.actor.userId, role, access };
}

/** Rows the actor may see, as a condition on contact_message. */
function visibleTo(access: InboxAccess) {
  if (access.kind === "all") return undefined;
  if (access.kind === "none") return sql`false`;
  return inArray(contactMessage.team, access.teams);
}

const assignee = aliasedTable(user, "assignee");

const ITEM = {
  id: contactMessage.id,
  reference: contactMessage.reference,
  topic: contactMessage.topic,
  team: contactMessage.team,
  name: contactMessage.name,
  subject: contactMessage.subject,
  status: contactMessage.status,
  assigneeId: assignee.id,
  assigneeName: assignee.name,
  createdAt: contactMessage.createdAt,
};

function personOf(id: string | null, name: string | null): Person | null {
  return id === null || name === null ? null : { id, name };
}

function itemOf<
  T extends { assigneeId: string | null; assigneeName: string | null },
>(
  row: T
): Omit<T, "assigneeId" | "assigneeName"> & { assignee: Person | null } {
  const { assigneeId, assigneeName, ...rest } = row;
  return { ...rest, assignee: personOf(assigneeId, assigneeName) };
}

function assigneeFilter(wanted: string | undefined, me: string) {
  if (wanted === undefined) return undefined;
  if (wanted === "unassigned") return isNull(contactMessage.assignedToUserId);
  return eq(contactMessage.assignedToUserId, wanted === "me" ? me : wanted);
}

export async function listContactInbox(
  ctx: UseCaseContext,
  input: ListContactInboxInput
): Promise<ListContactInboxResult> {
  const actor = await inboxActor(ctx, "contact.inbox.view");
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const filters = parsed.data;

  const rows = await ctx.db
    .select(ITEM)
    .from(contactMessage)
    .leftJoin(assignee, eq(assignee.id, contactMessage.assignedToUserId))
    .where(
      and(
        visibleTo(actor.access),
        filters.status && eq(contactMessage.status, filters.status),
        filters.team && eq(contactMessage.team, filters.team),
        filters.topic && eq(contactMessage.topic, filters.topic),
        assigneeFilter(filters.assignee, actor.userId)
      )
    )
    .orderBy(desc(contactMessage.createdAt), desc(contactMessage.id))
    .limit(LIST_LIMIT);
  return { ok: true, items: rows.map(itemOf) };
}

/** Staff who may handle `team`: its members and the admin roles. */
async function assignableStaff(
  db: AppDb,
  team: ContactTeam
): Promise<Person[]> {
  const roles = [...new Set<Role>(["staff_admin", "super_admin", team])];
  return db
    .selectDistinct({ id: user.id, name: user.name })
    .from(userRole)
    .innerJoin(user, eq(user.id, userRole.userId))
    .where(and(eq(userRole.scopeType, "global"), inArray(userRole.role, roles)))
    .orderBy(asc(user.name), asc(user.id));
}

export async function getContactMessage(
  ctx: UseCaseContext,
  input: { messageId: string }
): Promise<GetContactMessageResult> {
  const actor = await inboxActor(ctx, "contact.inbox.view");
  const id = messageId.safeParse(input.messageId);
  if (!id.success) return { ok: false, error: "not_found" };

  const [row] = await ctx.db
    .select({
      ...ITEM,
      email: contactMessage.email,
      organisation: contactMessage.organisation,
      message: contactMessage.message,
      closeReason: contactMessage.closeReason,
      closedAt: contactMessage.closedAt,
    })
    .from(contactMessage)
    .leftJoin(assignee, eq(assignee.id, contactMessage.assignedToUserId))
    .where(and(eq(contactMessage.id, id.data), visibleTo(actor.access)));
  if (!row) return { ok: false, error: "not_found" };

  const author = aliasedTable(user, "author");
  const notes = await ctx.db
    .select({
      id: contactNote.id,
      body: contactNote.body,
      authorId: author.id,
      authorName: author.name,
      createdAt: contactNote.createdAt,
    })
    .from(contactNote)
    .leftJoin(author, eq(author.id, contactNote.authorUserId))
    .where(eq(contactNote.messageId, row.id))
    .orderBy(asc(contactNote.createdAt), asc(contactNote.id));

  return {
    ok: true,
    message: {
      ...itemOf(row),
      notes: notes.map(({ authorId, authorName, ...note }) => ({
        ...note,
        author: personOf(authorId, authorName),
      })),
      assignableStaff: await assignableStaff(ctx.db, row.team),
    },
  };
}

/** What the audit log keeps of a message: never its words. */
function auditState(
  row: Pick<ContactMessage, "status" | "assignedToUserId" | "closeReason">
) {
  return {
    status: row.status,
    assigneeId: row.assignedToUserId,
    closeReason: row.closeReason,
  };
}

/** The message, locked for this transaction, if the actor may handle it. */
async function lockVisible(
  tx: AppDb,
  access: InboxAccess,
  id: string
): Promise<ContactMessage | undefined> {
  const [row] = await tx
    .select()
    .from(contactMessage)
    .where(and(eq(contactMessage.id, id), visibleTo(access)))
    .for("update");
  return row;
}

export async function assignContactMessage(
  ctx: UseCaseContext,
  input: { messageId: string; assigneeId: string | null }
): Promise<AssignContactMessageResult> {
  const actor = await inboxActor(ctx, "contact.inbox.handle");
  const parsed = assignInput.safeParse(input);
  if (!parsed.success) {
    return messageId.safeParse(input.messageId).success
      ? { ok: false, error: "invalid_input" }
      : { ok: false, error: "not_found" };
  }
  const { assigneeId } = parsed.data;

  return ctx.db.transaction(async (tx) => {
    const row = await lockVisible(tx, actor.access, parsed.data.messageId);
    if (!row) return { ok: false, error: "not_found" };
    const decision = decideAssignment({
      status: row.status,
      assigneeId: row.assignedToUserId,
      to: assigneeId,
    });
    if (!decision.ok) return decision;
    if (!decision.changed) return { ok: true, changed: false };
    if (assigneeId !== null) {
      const access = inboxAccess(await grantsOf(tx, assigneeId));
      if (!mayHandle(access, row.team)) {
        return { ok: false, error: "assignee_not_allowed" };
      }
    }

    const now = ctx.clock.now();
    const [updated] = await tx
      .update(contactMessage)
      .set({
        assignedToUserId: assigneeId,
        status: decision.status,
        updatedAt: now,
      })
      .where(eq(contactMessage.id, row.id))
      .returning();
    await recordAudit(tx, ctx, {
      action: "contact_message.assigned",
      entity: { type: "contact_message", id: row.id },
      before: auditState(row),
      after: auditState(updated!),
      actorRole: actor.role,
    });
    return { ok: true, changed: true };
  });
}

export async function changeContactMessageStatus(
  ctx: UseCaseContext,
  input: { messageId: string; status: string; closeReason?: string }
): Promise<ChangeContactMessageStatusResult> {
  const actor = await inboxActor(ctx, "contact.inbox.handle");
  const parsed = statusInput.safeParse(input);
  if (!parsed.success) {
    return messageId.safeParse(input.messageId).success
      ? { ok: false, error: "invalid_input" }
      : { ok: false, error: "not_found" };
  }

  return ctx.db.transaction(async (tx) => {
    const row = await lockVisible(tx, actor.access, parsed.data.messageId);
    if (!row) return { ok: false, error: "not_found" };
    const decision = decideStatusChange({
      from: row.status,
      to: parsed.data.status,
      closeReason: parsed.data.closeReason,
    });
    if (!decision.ok) return decision;
    if (!decision.changed) return { ok: true, changed: false };

    const now = ctx.clock.now();
    const [updated] = await tx
      .update(contactMessage)
      .set({
        status: decision.to,
        closeReason: decision.closeReason,
        closedAt: decision.to === "closed" ? now : null,
        updatedAt: now,
      })
      .where(eq(contactMessage.id, row.id))
      .returning();
    await recordAudit(tx, ctx, {
      action: "contact_message.status_changed",
      entity: { type: "contact_message", id: row.id },
      before: auditState(row),
      after: auditState(updated!),
      actorRole: actor.role,
    });
    return { ok: true, changed: true };
  });
}

export async function addContactNote(
  ctx: UseCaseContext,
  input: { messageId: string; body: string }
): Promise<AddContactNoteResult> {
  const actor = await inboxActor(ctx, "contact.inbox.handle");
  if (!messageId.safeParse(input.messageId).success) {
    return { ok: false, error: "not_found" };
  }
  const parsed = noteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  return ctx.db.transaction(async (tx) => {
    const row = await lockVisible(tx, actor.access, parsed.data.messageId);
    if (!row) return { ok: false, error: "not_found" };
    const now = ctx.clock.now();
    const noteId = uuidv7(now);
    await tx.insert(contactNote).values({
      id: noteId,
      messageId: row.id,
      authorUserId: actor.userId,
      body: parsed.data.body,
      createdAt: now,
    });
    await tx
      .update(contactMessage)
      .set({ updatedAt: now })
      .where(eq(contactMessage.id, row.id));
    await recordAudit(tx, ctx, {
      action: "contact_message.note_added",
      entity: { type: "contact_message", id: row.id },
      before: null,
      after: { noteId },
      actorRole: actor.role,
    });
    return { ok: true, noteId };
  });
}
