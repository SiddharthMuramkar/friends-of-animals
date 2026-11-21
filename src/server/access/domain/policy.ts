// The decision behind `can(actor, action, resource)` (#59). A policy maps
// each action to one rule; a rule looks at who is acting and at what, and
// allows or refuses. This core is pure: the caller loads the acting user's
// grants (fresh on every use case, so a grant or revoke counts at once) and
// says which scopes the target sits in.
//
// Loads under plain Node: no "server-only", no `@/` imports.

import type { Grant, Role, ScopedScope } from "./roles";

/** Who is acting, with the grants a signed-in user holds right now. */
export type Subject =
  | { kind: "visitor" }
  | { kind: "system"; process: "seed" | "worker" | "cli" }
  | { kind: "user"; userId: string; grants: readonly Grant[] };

/**
 * What the action is on. `scopes` lists every institution, competition or
 * organisation the target sits in (an entry sits in its competition and its
 * school); a target outside any scope passes `{}` and only global grants
 * cover it. `ownerId` is the user the target belongs to.
 */
export type Resource = {
  scopes?: readonly ScopedScope[];
  ownerId?: string;
};

/**
 * Allowed, with the role that allowed it (recorded in the audit log), or
 * `null` when no role was needed: the owner, the system, a signed-in user.
 */
export type Decision =
  | { allowed: true; role: Role | null }
  | { allowed: false };

export type Rule = (subject: Subject, resource: Resource) => Decision;

/** One rule per action. Actions are `<entity>.<verb>`, e.g. `role.grant`. */
export type Policy<Action extends string> = Readonly<Record<Action, Rule>>;

const REFUSED: Decision = { allowed: false };

function covers(grant: Grant, resource: Resource): boolean {
  const { scope } = grant;
  if (scope.type === "global") return true;
  return (resource.scopes ?? []).some(
    (target) => target.type === scope.type && target.id === scope.id
  );
}

/**
 * Allows a user holding one of `roles` at a scope covering the target.
 * The first of `roles` they hold that way is the one reported.
 */
export function role(...roles: Role[]): Rule {
  return (subject, resource) => {
    if (subject.kind !== "user") return REFUSED;
    for (const wanted of roles) {
      if (
        subject.grants.some(
          (grant) => grant.role === wanted && covers(grant, resource)
        )
      ) {
        return { allowed: true, role: wanted };
      }
    }
    return REFUSED;
  };
}

/** Allows the user the target belongs to. */
export const owner: Rule = (subject, resource) =>
  subject.kind === "user" &&
  resource.ownerId !== undefined &&
  subject.userId === resource.ownerId
    ? { allowed: true, role: null }
    : REFUSED;

/** Allows any signed-in user. */
export const signedIn: Rule = (subject) =>
  subject.kind === "user" ? { allowed: true, role: null } : REFUSED;

/** Allows the platform itself, running as one of `processes`. */
export function system(
  ...processes: Extract<Subject, { kind: "system" }>["process"][]
): Rule {
  return (subject) =>
    subject.kind === "system" && processes.includes(subject.process)
      ? { allowed: true, role: null }
      : REFUSED;
}

/** Allows when any of `rules` does; the first that allows decides. */
export function anyOf(...rules: Rule[]): Rule {
  return (subject, resource) => {
    for (const rule of rules) {
      const decision = rule(subject, resource);
      if (decision.allowed) return decision;
    }
    return REFUSED;
  };
}

/** Decides one action. An action the policy doesn't define is refused. */
export function decide<Action extends string>(
  policy: Policy<Action>,
  subject: Subject,
  action: Action,
  resource: Resource = {}
): Decision {
  const rule = Object.hasOwn(policy, action) ? policy[action] : undefined;
  return rule ? rule(subject, resource) : REFUSED;
}
