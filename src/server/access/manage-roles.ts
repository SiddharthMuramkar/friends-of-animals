// Granting, revoking and listing scoped roles (#59).
//
//   grantRole({ userId, role, scope })   → super admin (or the operator's CLI)
//   revokeRole({ userId, role, scope })  → super admin
//   listUserRoles({ userId })            → the user, a super or staff admin
//
// A change locks the grantee's and the actor's user rows and checks the
// actor again inside its transaction, so concurrent changes to one user
// queue, each audit entry's before and after are exact, and a revoked
// admin can't finish a change they started. Loads under
// plain Node (the bootstrap command): relative imports only.

import { asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { AppDb } from "../db/app-db";
import { user, userRole } from "../db/schema";
import { uuidv7 } from "../ids";
import { invalidInput, type InvalidInput } from "../input";
import { recordAudit } from "../audit/record";
import { capSessionsAtStaffLifetime } from "../second-factor/session-lifetimes";
import type { UseCaseContext } from "../use-cases";
import { authorize } from "./can";
import {
  grantKey,
  grantSchema,
  isStaffRole,
  ROLES,
  scopeSchema,
  sortGrants,
  type Grant,
  type Role,
  type Scope,
} from "./domain/roles";
import { globalSuperAdminRows, grantOf, grantRow, grantsOf } from "./grants";

/** What the access use cases use: the database, the clock and the actor. */
export type AccessContext = Pick<UseCaseContext, "db" | "clock" | "actor">;

export type GrantChangeInput = { userId: string; role: Role; scope: Scope };

export type GrantRoleResult =
  | { ok: true; changed: boolean; grant: Grant }
  | InvalidInput
  | { ok: false; error: "scope_not_allowed" | "not_found" };

const grantChangeInput = z.object({
  userId: z.uuid(),
  role: z.enum(ROLES),
  scope: scopeSchema,
});

type ParsedGrantChange =
  | { ok: true; userId: string; grant: Grant }
  | InvalidInput
  | { ok: false; error: "scope_not_allowed" };

function parseGrantChange(input: GrantChangeInput): ParsedGrantChange {
  const parsed = grantChangeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { userId, role, scope } = parsed.data;
  // grantSchema holds the rule of which scopes each role may have.
  if (!grantSchema.safeParse({ role, scope }).success) {
    return { ok: false, error: "scope_not_allowed" };
  }
  return { ok: true, userId, grant: { role, scope } };
}

/**
 * Locks the user's row, and the acting user's, until the transaction ends;
 * false if the user doesn't exist. Rows are locked in id order in one
 * statement, so two admins changing each other's roles at once queue
 * rather than deadlock, and a revoke of the actor's own role waits for
 * this change or this change waits for it.
 */
async function lockUsers(
  tx: AppDb,
  userId: string,
  actor: AccessContext["actor"]
): Promise<boolean> {
  const ids = new Set([userId]);
  if (actor.kind === "user") ids.add(actor.userId);
  const rows = await tx
    .select({ id: user.id })
    .from(user)
    .where(inArray(user.id, [...ids]))
    .orderBy(asc(user.id))
    .for("no key update");
  return rows.some((row) => row.id === userId);
}

/**
 * The check again, inside the change's transaction once the rows are
 * locked: a revoke of the actor's own role that committed since the first
 * check counts. Returns the role that allows it, for the audit log.
 */
async function authorizeIn(
  tx: AppDb,
  ctx: AccessContext,
  action: "role.grant" | "role.revoke"
) {
  return authorize({ db: tx, clock: ctx.clock, actor: ctx.actor }, action);
}

/**
 * Gives a user one role at one scope. Holding it already changes nothing
 * and records nothing (`changed: false`).
 */
export async function grantRole(
  ctx: AccessContext,
  input: GrantChangeInput
): Promise<GrantRoleResult> {
  await authorize(ctx, "role.grant");
  const parsed = parseGrantChange(input);
  if (!parsed.ok) return parsed;
  const { userId, grant } = parsed;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const found = await lockUsers(tx, userId, ctx.actor);
    const { role: actorRole } = await authorizeIn(tx, ctx, "role.grant");
    if (!found) return { ok: false, error: "not_found" } as const;
    const before = await grantsOf(tx, userId);
    const [inserted] = await tx
      .insert(userRole)
      .values({
        id: uuidv7(now),
        userId,
        role: grant.role,
        scopeType: grant.scope.type,
        scopeId: grant.scope.type === "global" ? null : grant.scope.id,
        grantedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        grantedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: userRole.id });
    if (!inserted) return { ok: true, changed: false, grant } as const;
    // Staff sessions are shorter (#60): the grantee's open ones too.
    if (isStaffRole(grant.role)) await capSessionsAtStaffLifetime(tx, userId);

    await recordAudit(tx, ctx, {
      action: "role.granted",
      entity: { type: "user", id: userId },
      before,
      after: sortGrants([...before, grant]),
      actorRole,
    });
    return { ok: true, changed: true, grant } as const;
  });
}

export type RevokeRoleResult =
  | { ok: true; changed: boolean; grant: Grant }
  | InvalidInput
  | {
      ok: false;
      error: "scope_not_allowed" | "not_found" | "last_super_admin";
    };

/**
 * How many users hold global super admin, with their rows locked until the
 * transaction ends, so two super admins revoking each other at once can't
 * leave none.
 */
async function lockGlobalSuperAdmins(tx: AppDb): Promise<number> {
  const rows = await tx
    .select({ id: userRole.id })
    .from(userRole)
    .where(globalSuperAdminRows)
    .orderBy(asc(userRole.id))
    .for("update");
  return rows.length;
}

const isGlobalSuperAdmin = (grant: Grant) =>
  grant.role === "super_admin" && grant.scope.type === "global";

/**
 * Takes one role at one scope away from a user. Not holding it changes
 * nothing and records nothing (`changed: false`). The last global super
 * admin stays, so someone can always manage roles.
 */
export async function revokeRole(
  ctx: AccessContext,
  input: GrantChangeInput
): Promise<RevokeRoleResult> {
  await authorize(ctx, "role.revoke");
  const parsed = parseGrantChange(input);
  if (!parsed.ok) return parsed;
  const { userId, grant } = parsed;

  return ctx.db.transaction(async (tx) => {
    const found = await lockUsers(tx, userId, ctx.actor);
    const { role: actorRole } = await authorizeIn(tx, ctx, "role.revoke");
    if (!found) return { ok: false, error: "not_found" } as const;
    const before = await grantsOf(tx, userId);
    const key = grantKey(grant);
    if (!before.some((held) => grantKey(held) === key)) {
      return { ok: true, changed: false, grant } as const;
    }
    if (isGlobalSuperAdmin(grant) && (await lockGlobalSuperAdmins(tx)) <= 1) {
      return { ok: false, error: "last_super_admin" } as const;
    }

    await tx.delete(userRole).where(grantRow(userId, grant));
    await recordAudit(tx, ctx, {
      action: "role.revoked",
      entity: { type: "user", id: userId },
      before,
      after: before.filter((held) => grantKey(held) !== key),
      actorRole,
    });
    return { ok: true, changed: true, grant } as const;
  });
}

/** A grant as the roles screen shows it. */
export type UserGrant = Grant & {
  grantedAt: Date;
  /** Null for seed data, the operator's CLI, or a deleted account. */
  grantedBy: { id: string; name: string } | null;
};

export type ListUserRolesResult =
  | {
      ok: true;
      user: { id: string; name: string; email: string };
      grants: UserGrant[];
    }
  | InvalidInput
  | { ok: false; error: "not_found" };

const listUserRolesInput = z.object({ userId: z.uuid() });

const granter = alias(user, "granter");

/** A user's account and every grant they hold, sorted by `grantKey`. */
export async function listUserRoles(
  ctx: AccessContext,
  input: { userId: string }
): Promise<ListUserRolesResult> {
  await authorize(ctx, "role.list", { ownerId: input.userId });
  const parsed = listUserRolesInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { userId } = parsed.data;

  const [account] = await ctx.db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  if (!account) return { ok: false, error: "not_found" };

  const rows = await ctx.db
    .select({
      role: userRole.role,
      scopeType: userRole.scopeType,
      scopeId: userRole.scopeId,
      grantedAt: userRole.grantedAt,
      granterId: granter.id,
      granterName: granter.name,
    })
    .from(userRole)
    .leftJoin(granter, eq(granter.id, userRole.grantedByUserId))
    .where(eq(userRole.userId, userId))
    .orderBy(asc(userRole.id));

  const grants = rows
    .map((row): UserGrant => ({
      ...grantOf(row),
      grantedAt: row.grantedAt,
      grantedBy:
        row.granterId === null || row.granterName === null
          ? null
          : { id: row.granterId, name: row.granterName },
    }))
    .sort((a, b) => grantKey(a).localeCompare(grantKey(b)));
  return { ok: true, user: account, grants };
}
