// What a redirect back to a campaign's page says: a change that worked
// (`done`) or a send refused (`refused`), with `at` so the same notice
// shows again for a second change.

import { adminCampaignPath } from "@/lib/app-routes";

export const DONE = ["created", "saved", "sent"] as const;
export type Done = (typeof DONE)[number];

export const REFUSALS = [
  "forbidden",
  "not_found",
  "unconfirmed",
  "campaign_already_sent",
  "campaign_draft_changed",
  "segment_empty",
] as const;
export type Refusal = (typeof REFUSALS)[number];

export type Outcome =
  | { done: Done; at: string }
  | { refused: Refusal; at: string }
  | null;

export function campaignHref(
  campaignId: string,
  outcome?: { done: Done } | { refused: Refusal },
  at?: number
): string {
  const path = adminCampaignPath(campaignId);
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
