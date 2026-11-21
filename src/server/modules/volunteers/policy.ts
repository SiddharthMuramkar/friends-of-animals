// Who may run the volunteer use cases. Each one calls `authorize` first,
// and an action without a rule here is refused. When #59's policy table
// is on this branch, these rules join it as VOLUNTEER_POLICY and the call
// sites stay.

import type { Actor } from "../../actor";
import { DomainError } from "../../errors";

export type VolunteerAction = "volunteer.view-own";

export function can(actor: Actor, action: VolunteerAction): boolean {
  switch (action) {
    case "volunteer.view-own":
      // A signed-in user, for their own application only: the query
      // matches the actor's applications and nobody else's.
      return actor.kind === "user";
    default:
      // Deny by default: an action without a rule is no one's.
      return false;
  }
}

export function authorize(actor: Actor, action: VolunteerAction): void {
  if (!can(actor, action)) {
    throw new DomainError("forbidden", `${actor.kind} may not ${action}`);
  }
}
