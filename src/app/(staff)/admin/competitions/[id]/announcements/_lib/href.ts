// Links to the announcement pages, and what a redirect back to one says: a
// change that worked (`done`) or a refusal (`refused`), with `at` so the
// same notice shows again for a second change.

export const DONE = ["created", "saved", "sent"] as const;
export type Done = (typeof DONE)[number];

/** Refusals the send button can come back with. */
export const REFUSALS = [
  "forbidden",
  "not_found",
  "unconfirmed",
  "announcement_already_sent",
  "announcement_draft_changed",
] as const;
export type Refusal = (typeof REFUSALS)[number];

export type Outcome =
  | { done: Done; at: string }
  | { refused: Refusal; at: string }
  | null;

export function announcementsHref(competitionId: string): string {
  return `/admin/competitions/${encodeURIComponent(competitionId)}/announcements`;
}

export function newAnnouncementHref(competitionId: string): string {
  return `${announcementsHref(competitionId)}/new`;
}

export function announcementHref(
  competitionId: string,
  announcementId: string,
  outcome?: { done: Done } | { refused: Refusal },
  at?: number
): string {
  const path = `${announcementsHref(competitionId)}/${encodeURIComponent(announcementId)}`;
  if (!outcome) return path;
  const params = new URLSearchParams(
    "done" in outcome ? { done: outcome.done } : { refused: outcome.refused }
  );
  if (at !== undefined) params.set("at", String(at));
  return `${path}?${params}`;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isOneOf<T extends string>(
  list: readonly T[],
  value: string | undefined
): value is T {
  return value !== undefined && (list as readonly string[]).includes(value);
}

/** The outcome in a page's search params; null for none or junk. */
export function readOutcome(
  params: Record<string, string | string[] | undefined>
): Outcome {
  const at = one(params.at) ?? "";
  const done = one(params.done);
  if (isOneOf(DONE, done)) return { done, at };
  const refused = one(params.refused);
  if (isOneOf(REFUSALS, refused)) return { refused, at };
  return null;
}
