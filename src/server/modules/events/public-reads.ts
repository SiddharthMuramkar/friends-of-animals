// The public reads (#125): the list on /events and the page at
// /events/<slug>. Anyone may run them. Drafts never show; an event that
// was published keeps its page after it is cancelled or completed, so
// shared links still work, and the page says what happened.

import { and, asc, eq, gt, isNotNull } from "drizzle-orm";

import type { LegalBlock } from "../../../content/legal/model";
import { event, type EventRow } from "../../db/schema";
import { sanitizeBlocks } from "../../rich-text/blocks";
import type { UseCaseContext } from "../../use-cases";
import type { EventsAccess } from "./access";
import type { EventAudience } from "./domain/event-details";
import type { EventKind, EventStatus } from "./domain/event-status";
import {
  registrationWindow,
  type RegistrationWindow,
} from "./domain/registration-window";
import { EVENT_SLUG_PATTERN } from "./domain/slug";

/** One upcoming or ongoing event in the public list. */
export type PublicEventSummary = {
  slug: string;
  kind: EventKind;
  title: string;
  summary: string;
  startsAt: Date;
  endsAt: Date;
  city: string | null;
  /** It happens online. The link itself is for registrants only. */
  online: boolean;
  registration: RegistrationWindow;
};

/** An event's public page. */
export type PublicEvent = PublicEventSummary & {
  status: Exclude<EventStatus, "draft">;
  description: LegalBlock[];
  venueName: string | null;
  address: string | null;
  pinCode: string | null;
  /** Places; null means unlimited. */
  capacity: number | null;
  audience: EventAudience;
};

export type GetPublicEventResult =
  | { ok: true; event: PublicEvent }
  | { ok: false; error: "not_found" };

function summaryOf(row: EventRow, now: Date): PublicEventSummary {
  return {
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    city: row.city,
    online: row.onlineUrl !== null,
    registration: registrationWindow(row, now),
  };
}

/** Published events that haven't ended, the soonest start first. */
export async function listPublishedEvents(
  ctx: UseCaseContext,
  access: EventsAccess
): Promise<PublicEventSummary[]> {
  await access.authorize(ctx, "event.read_public");
  const now = ctx.clock.now();
  const rows = await ctx.db
    .select()
    .from(event)
    .where(and(eq(event.status, "published"), gt(event.endsAt, now)))
    .orderBy(asc(event.startsAt), asc(event.id));
  return rows.map((row) => summaryOf(row, now));
}

/** The page for `slug`, if that event was ever published. */
export async function getPublicEvent(
  ctx: UseCaseContext,
  access: EventsAccess,
  input: { slug: string }
): Promise<GetPublicEventResult> {
  await access.authorize(ctx, "event.read_public");
  if (!EVENT_SLUG_PATTERN.test(input.slug)) {
    return { ok: false, error: "not_found" };
  }
  const [row] = await ctx.db
    .select()
    .from(event)
    .where(and(eq(event.slug, input.slug), isNotNull(event.publishedAt)));
  if (!row || row.status === "draft") return { ok: false, error: "not_found" };
  return {
    ok: true,
    event: {
      ...summaryOf(row, ctx.clock.now()),
      status: row.status,
      description: sanitizeBlocks(row.description, "cms"),
      venueName: row.venueName,
      address: row.address,
      pinCode: row.pinCode,
      capacity: row.capacity,
      audience: row.audience,
    },
  };
}
