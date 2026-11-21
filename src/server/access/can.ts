import type { Actor } from "../actor";
import type { AppDb } from "../db/app-db";
import type { Decision, Policy, Resource } from "./domain/policy";
import type { Role } from "./domain/roles";

export type PolicyContext = { db: AppDb; actor: Actor };

export function policyCheck<Action extends string>(_policy: Policy<Action>) {
  async function can(
    _ctx: PolicyContext,
    _action: Action,
    _resource: Resource = {}
  ): Promise<Decision> {
    return { allowed: false };
  }

  async function authorize(
    _ctx: PolicyContext,
    _action: Action,
    _resource: Resource = {}
  ): Promise<{ role: Role | null }> {
    return { role: null };
  }

  return { can, authorize };
}
