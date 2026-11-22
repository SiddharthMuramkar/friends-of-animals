// What the competitions page says after the register button, from
// registerInstitutionForCompetition's result, and which institution it
// opens. Pure, so the mapping is tested without a page.

import type { Grant } from "@/server/access";
import type { RegisterInstitutionForCompetitionResult } from "@/server/modules/registration";

export const REGISTER_OUTCOMES = [
  "registered",
  "not_found",
  "institutions_not_accepted",
  "institution_not_verified",
  "already_registered",
  "not_open_yet",
  "closed",
  "failed",
] as const;

export type RegisterOutcome = (typeof REGISTER_OUTCOMES)[number];

export function isRegisterOutcome(value: unknown): value is RegisterOutcome {
  return REGISTER_OUTCOMES.includes(value as RegisterOutcome);
}

/** The result as the page says it; `undefined` when the use case threw. */
export function registerOutcome(
  result: RegisterInstitutionForCompetitionResult | undefined
): RegisterOutcome {
  if (!result) return "failed";
  if (result.ok) return "registered";
  // The page's own buttons send well-formed ids: bad input means the
  // competition it named isn't there.
  return result.error === "invalid_input" ? "not_found" : result.error;
}

/**
 * The institutions the user acts for, as a coordinator or as the
 * authorised person, each once, in the order of their grants.
 */
export function actingInstitutions(grants: readonly Grant[]): string[] {
  const ids = grants.flatMap((grant) =>
    (grant.role === "institution_admin" ||
      grant.role === "institution_coordinator") &&
    grant.scope.type === "institution"
      ? [grant.scope.id]
      : []
  );
  return [...new Set(ids)];
}

/** The institution asked for, if the user acts for it; else their first. */
export function chooseInstitution(
  institutionIds: readonly string[],
  requested: string | undefined
): string | undefined {
  return requested !== undefined && institutionIds.includes(requested)
    ? requested
    : institutionIds[0];
}
