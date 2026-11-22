// Where the chooser's "Participate as an Individual" button leads (#78):
// the register form of the competition the visitor came from
// (`/participate?competition=<slug>`), or the competitions list to pick one
// first. Anything that isn't one plain slug is ignored, so the query string
// can't steer the link anywhere else.
//
// Pure: no imports beyond the routes.

import { individualRegisterPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";

/** The same pattern as competition slugs (src/server/db/schema). */
const SLUG = /^[a-z0-9-]{3,80}$/;

export type IndividualLink =
  | { kind: "register"; href: string }
  | { kind: "choose"; href: string };

export function individualLink(
  competition: string | string[] | undefined
): IndividualLink {
  if (typeof competition === "string" && SLUG.test(competition)) {
    return { kind: "register", href: individualRegisterPath(competition) };
  }
  return { kind: "choose", href: ROUTES.competitions.path };
}
