// Where a refused use case sends the user so they can go on: to enrol a
// second factor, to pass it for this session, or to step up (#60). Edges
// (Server Actions, staff layouts) catch the DomainError and redirect here
// with `next`, the page to come back to. Pure, no I/O.

import type { DomainErrorCode } from "@/server/errors";

import { APP_ROUTES } from "./app-routes";

/**
 * `raw` if it is a path on this site to come back to, else null. Refuses
 * anything a browser could read as another origin ("//host", "/\host"),
 * a scheme, or control characters.
 */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return null;
  }
  // oxlint-disable-next-line no-control-regex -- refusing them is the point
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  return raw;
}

/**
 * The request header src/proxy.ts sets to the path (and query) of a
 * signed-in page, so the staff gate can name the page to come back to.
 */
export const PATH_HEADER = "x-foa-path";

const PAGES: Partial<Record<DomainErrorCode, string>> = {
  enrolment_required: APP_ROUTES.accountSecurity,
  second_factor_required: APP_ROUTES.secondFactor,
  step_up_required: APP_ROUTES.stepUp,
};

/**
 * The page that lifts a second-factor refusal, with `next` to return to,
 * or null for a refusal no second factor can lift (forbidden).
 */
export function secondFactorPath(
  code: DomainErrorCode,
  next?: string
): string | null {
  const page = PAGES[code];
  if (!page) return null;
  const back = safeNext(next);
  return back ? `${page}?next=${encodeURIComponent(back)}` : page;
}
