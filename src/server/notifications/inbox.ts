// The in-app inbox (#69): a signed-in user's own messages.
//
//   listInbox({ limit? })        → newest first
//   countUnread()                → for the header badge
//   markInboxItemRead({ id })    → once; another user's item is "not found"
//   markAllInboxRead()           → every unread one
//
// Every query matches the actor's user id, so another user's item is never
// read or changed, and the answer never says it exists.

import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../access/can";
import { inboxItem } from "../db/schema";
import type { UseCaseContext } from "../use-cases";
import { isInboxLink } from "./domain/inbox-link";

export type InboxItemView = {
  id: string;
  title: string;
  body: string;
  /** A path on this site, or null. */
  link: string | null;
  createdAt: Date;
  readAt: Date | null;
};

export const INBOX_PAGE_SIZE = 50;

const listInput = z
  .object({ limit: z.number().int().min(1).max(100).optional() })
  .optional();

const markInput = z.object({ id: z.uuid() });

/** The signed-in user's id; `authorize` has ruled out other actors. */
function ownerId(ctx: UseCaseContext): string {
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  return ctx.actor.userId;
}

export async function listInbox(
  ctx: UseCaseContext,
  input?: { limit?: number }
): Promise<InboxItemView[]> {
  await authorize(ctx, "inbox.view");
  const parsed = listInput.safeParse(input);
  const limit = (parsed.success && parsed.data?.limit) || INBOX_PAGE_SIZE;
  const rows = await ctx.db
    .select({
      id: inboxItem.id,
      title: inboxItem.title,
      body: inboxItem.body,
      link: inboxItem.link,
      createdAt: inboxItem.createdAt,
      readAt: inboxItem.readAt,
    })
    .from(inboxItem)
    .where(eq(inboxItem.userId, ownerId(ctx)))
    .orderBy(desc(inboxItem.createdAt), desc(inboxItem.id))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    // Links come from code, but the page renders them as hrefs.
    link: row.link !== null && isInboxLink(row.link) ? row.link : null,
  }));
}

export async function countUnread(ctx: UseCaseContext): Promise<number> {
  await authorize(ctx, "inbox.view");
  const [row] = await ctx.db
    .select({ n: count() })
    .from(inboxItem)
    .where(and(eq(inboxItem.userId, ownerId(ctx)), isNull(inboxItem.readAt)));
  return row?.n ?? 0;
}

export type MarkInboxItemReadResult =
  | { ok: true }
  | { ok: false; error: "not_found" };

export async function markInboxItemRead(
  ctx: UseCaseContext,
  input: { id: string }
): Promise<MarkInboxItemReadResult> {
  await authorize(ctx, "inbox.mark_read");
  const userId = ownerId(ctx);
  const parsed = markInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const [item] = await ctx.db
    .select({ id: inboxItem.id, readAt: inboxItem.readAt })
    .from(inboxItem)
    .where(and(eq(inboxItem.id, parsed.data.id), eq(inboxItem.userId, userId)));
  if (!item) return { ok: false, error: "not_found" };
  // Read once: the first time it was read stays.
  if (item.readAt === null) {
    await ctx.db
      .update(inboxItem)
      .set({ readAt: ctx.clock.now() })
      .where(and(eq(inboxItem.id, item.id), isNull(inboxItem.readAt)));
  }
  return { ok: true };
}

export async function markAllInboxRead(
  ctx: UseCaseContext
): Promise<{ ok: true; marked: number }> {
  await authorize(ctx, "inbox.mark_read");
  const marked = await ctx.db
    .update(inboxItem)
    .set({ readAt: ctx.clock.now() })
    .where(and(eq(inboxItem.userId, ownerId(ctx)), isNull(inboxItem.readAt)))
    .returning({ id: inboxItem.id });
  return { ok: true, marked: marked.length };
}
