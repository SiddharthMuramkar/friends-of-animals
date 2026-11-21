// can(ctx, action, resource): the one place that decides who may run a use
// case. Every use case awaits `authorize` first; it throws forbidden when
// `can` refuses. A signed-in user's grants are read from the database on
// every call, so a grant or revoke counts at once, even for a session that
// was already open. Loads under plain Node (the bootstrap command):
// relative imports only, no "server-only".

import type { Actor } from "../actor";
import type { AppDb } from "../db/app-db";
import { DomainError } from "../errors";
import {
  decide,
  type Decision,
  type Policy,
  type Resource,
  type Subject,
} from "./domain/policy";
import type { Role } from "./domain/roles";
import { grantsOf } from "./grants";
import { POLICY, type Action } from "./policies";

/** What a check needs: who is acting, and the database their grants are in. */
export type PolicyContext = { db: AppDb; actor: Actor };

async function subjectOf({ db, actor }: PolicyContext): Promise<Subject> {
  switch (actor.kind) {
    case "visitor":
      return { kind: "visitor" };
    case "system":
      return { kind: "system", process: actor.process };
    case "user":
      return {
        kind: "user",
        userId: actor.userId,
        grants: await grantsOf(db, actor.userId),
      };
  }
}

/** `can` and `authorize` over one policy. */
export function policyCheck<A extends string>(policy: Policy<A>) {
  /**
   * Whether the actor may take `action` on `resource`, and the role that
   * allowed it. `resource.scopes` lists every scope the target sits in;
   * `resource.ownerId` is the user it belongs to.
   */
  async function can(
    ctx: PolicyContext,
    action: A,
    resource: Resource = {}
  ): Promise<Decision> {
    return decide(policy, await subjectOf(ctx), action, resource);
  }

  /**
   * Throws DomainError("forbidden") unless `can` allows; returns the role
   * that allowed it, for the audit log.
   */
  async function authorize(
    ctx: PolicyContext,
    action: A,
    resource: Resource = {}
  ): Promise<{ role: Role | null }> {
    const decision = await can(ctx, action, resource);
    if (!decision.allowed) {
      throw new DomainError("forbidden", `${ctx.actor.kind} may not ${action}`);
    }
    return { role: decision.role };
  }

  return { can, authorize };
}

export const { can, authorize } = policyCheck<Action>(POLICY);
