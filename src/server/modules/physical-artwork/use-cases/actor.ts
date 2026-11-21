// Who is acting, once a check has ruled out everyone but a signed-in user.
//
// Loads under plain Node: relative imports only, no "server-only".

import { DomainError } from "../../../errors";
import type { UseCaseContext } from "../../../use-cases";

/** The signed-in user's id; anyone else may not act here. */
export function actingUserId(ctx: UseCaseContext): string {
  if (ctx.actor.kind !== "user") {
    throw new DomainError(
      "forbidden",
      `${ctx.actor.kind} may not act on physical artwork`
    );
  }
  return ctx.actor.userId;
}
