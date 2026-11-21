// Who may use a public form: anyone on the site, signed in or not. The
// platform's own processes (seed, worker, CLI) have no request and no
// reason to, so they are refused. Deny by default, as #59's policy does.

import type { Actor, RequestMeta } from "../../actor";
import { DomainError } from "../../errors";

/** The request behind a public form's use case, or `forbidden`. */
export function publicSender(actor: Actor, action: string): RequestMeta {
  if (actor.kind === "visitor" || actor.kind === "user") return actor.meta;
  throw new DomainError("forbidden", `${actor.kind} may not ${action}`);
}
