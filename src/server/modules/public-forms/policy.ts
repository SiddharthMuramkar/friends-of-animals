// The request behind a public form's use case, once the platform policy
// allows the action. A public form needs the caller's IP for its limits,
// so only a visitor or a signed-in user can have one.

import { authorize, type PolicyContext } from "../../access/can";
import type { Action } from "../../access/policies";
import type { RequestMeta } from "../../actor";
import { DomainError } from "../../errors";

/** Authorizes `action` and returns the caller's request, or `forbidden`. */
export async function publicSender(
  ctx: PolicyContext,
  action: Action
): Promise<RequestMeta> {
  await authorize(ctx, action);
  const { actor } = ctx;
  if (actor.kind === "visitor" || actor.kind === "user") return actor.meta;
  throw new DomainError("forbidden", `${actor.kind} may not ${action}`);
}
