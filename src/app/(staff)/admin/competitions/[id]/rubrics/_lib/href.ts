// Links to the rubric pages, and what a redirect back to one says: a
// change that worked (`done`) or a refusal (`refused`), with `at` so the
// same notice shows again for a second change.

import type { Discipline } from "@/server/modules/competitions/domain/vocabulary";

export const DONE = ["created", "saved", "published", "revision"] as const;
export type Done = (typeof DONE)[number];

/** Refusals a start or revise button can come back with. */
export const REFUSALS = [
  "forbidden",
  "not_found",
  "invalid_input",
  "rubric_exists",
  "rubric_locked_by_judging",
  "discipline_not_enabled",
  "draft_exists",
  "not_published",
] as const;
export type Refusal = (typeof REFUSALS)[number];

export type Outcome =
  | { done: Done; at: string }
  | { refused: Refusal; at: string }
  | null;

export function rubricsHref(competitionId: string): string {
  return `/admin/competitions/${encodeURIComponent(competitionId)}/rubrics`;
}

export function disciplineRubricHref(
  competitionId: string,
  discipline: Discipline,
  outcome?: { done: Done } | { refused: Refusal },
  at?: number
): string {
  const path = `${rubricsHref(competitionId)}/${discipline}`;
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

/** The outcome in a rubric page's search params; null for none or junk. */
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
