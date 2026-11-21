// Granting, revoking and listing scoped roles (#59).
//
//   grantRole({ userId, role, scope })   → super admin (or the operator's CLI)
//   revokeRole({ userId, role, scope })  → super admin (or the operator's CLI)
//   listUserRoles({ userId })            → the user, a super or staff admin
//
// A change locks the grantee's user row, so concurrent changes to one user
// queue and each audit entry's before and after are exact. Loads under
// plain Node (the bootstrap command): relative imports only.

import { and, asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { AppDb } from "../db/app-db";
import { user, userRole } from "../db/schema";
import { uuidv7 } from "../ids";
import { invalidInput, type InvalidInput } from "../input";
import { recordAudit } from "../audit/record";
import type { UseCaseContext } from "../use-cases";
import { authorize } from "./can";
import {
  grantKey,
  grantSchema,
  ROLES,
  scopeSchema,
  sortGrants,
  type Grant,
  type Role,
  type Scope,
} from "./domain/roles";
import { grantOf, grantRow, grantsOf } from "./grants";

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

/** Locks the user's row until the transaction ends; false if there is none. */
async function lockUser(tx: AppDb, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("no key update");
  return row !== undefined;
}

/**
 * Gives a user one role at one scope. Holding it already changes nothing
 * and records nothing (`changed: false`).
 */
export async function grantRole(
  ctx: AccessContext,
  input: GrantChangeInput
): Promise<GrantRoleResult> {
  const { role: actorRole } = await authorize(ctx, "role.grant");
  const parsed = parseGrantChange(input);
  if (!parsed.ok) return parsed;
  const { userId, grant } = parsed;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    if (!(await lockUser(tx, userId))) {
      return { ok: false, error: "not_found" } as const;
    }
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
    .where(
      and(
        eq(userRole.role, "super_admin"),
        eq(userRole.scopeType, "global"),
        isNull(userRole.scopeId)
      )
    )
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
  const { role: actorRole } = await authorize(ctx, "role.revoke");
  const parsed = parseGrantChange(input);
  if (!parsed.ok) return parsed;
  const { userId, grant } = parsed;

  return ctx.db.transaction(async (tx) => {
    if (!(await lockUser(tx, userId))) {
      return { ok: false, error: "not_found" } as const;
    }
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
