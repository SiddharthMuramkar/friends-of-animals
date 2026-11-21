// The authorised person's side of coordinators (#74):
//
//   listCoordinators({ institutionId })                 → who coordinates,
//                                                          and who is invited
//   removeCoordinator({ institutionId, userId })        → takes the role away
//   revokeInvitation({ institutionId, invitationId })   → withdraws a link
//
// Every one checks institution.coordinators.manage at the institution's
// scope first; removing and withdrawing check again inside their
// transaction, so an authorised person who just lost the role can't finish.
// The role is read fresh on every use case (#59), so a removed coordinator's
// next call is refused even with their session still open.

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { Grant } from "../../access/domain/roles";
import { grantKey } from "../../access/domain/roles";
import { grantRow, grantsOf } from "../../access/grants";
import { recordAudit } from "../../audit/record";
import {
  institution,
  institutionInvitation,
  user,
  userRole,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import {
  decideInvitation,
  invitationStatus,
  type InvitationRefusal,
} from "../domain/invitation";
import { maskIdentifier, type InviteeChannel } from "../domain/mask-identifier";
import { institutionResource } from "./invite-coordinator";
import { readInvitee } from "./invitee";

export type Coordinator = { userId: string; name: string; since: Date };

export type WaitingInvitation = {
  id: string;
  channel: InviteeChannel;
  maskedIdentifier: string;
  /** Pending, or expired once seven days pass without an accept. */
  status: "pending" | "expired";
  sentAt: Date;
  expiresAt: Date;
};

export type ListCoordinatorsResult =
  | {
      ok: true;
      institution: { id: string; name: string };
      coordinators: Coordinator[];
      invitations: WaitingInvitation[];
    }
  | InvalidInput
  | { ok: false; error: "not_found" };

export type RemoveCoordinatorResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: "not_found" };

export type RevokeInvitationResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: "not_found" | InvitationRefusal };

const institutionInput = z.object({ institutionId: z.uuid() });
const removeInput = z.object({ institutionId: z.uuid(), userId: z.uuid() });
const revokeInput = z.object({
  institutionId: z.uuid(),
  invitationId: z.uuid(),
});

function coordinatorGrant(institutionId: string): Grant {
  return {
    role: "institution_coordinator",
    scope: { type: "institution", id: institutionId },
  };
}

export async function listCoordinators(
  ctx: UseCaseContext,
  input: { institutionId: string }
): Promise<ListCoordinatorsResult> {
  await authorize(
    ctx,
    "institution.coordinators.manage",
    institutionResource(input.institutionId)
  );
  const parsed = institutionInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId } = parsed.data;

  const [found] = await ctx.db
    .select({ id: institution.id, name: institution.name })
    .from(institution)
    .where(eq(institution.id, institutionId));
  if (!found) return { ok: false, error: "not_found" };

  const coordinators = await ctx.db
    .select({ userId: user.id, name: user.name, since: userRole.grantedAt })
    .from(userRole)
    .innerJoin(user, eq(user.id, userRole.userId))
    .where(
      and(
        eq(userRole.role, "institution_coordinator"),
        eq(userRole.scopeType, "institution"),
        eq(userRole.scopeId, institutionId)
      )
    )
    .orderBy(asc(user.name), asc(user.id));

  const rows = await ctx.db
    .select({
      id: institutionInvitation.id,
      channel: institutionInvitation.channel,
      identifierCiphertext: institutionInvitation.identifierCiphertext,
      status: institutionInvitation.status,
      createdAt: institutionInvitation.createdAt,
      expiresAt: institutionInvitation.expiresAt,
    })
    .from(institutionInvitation)
    .where(
      and(
        eq(institutionInvitation.institutionId, institutionId),
        eq(institutionInvitation.status, "pending")
      )
    )
    .orderBy(
      asc(institutionInvitation.createdAt),
      asc(institutionInvitation.id)
    );
  const now = ctx.clock.now();
  const invitations = rows.map((row): WaitingInvitation => {
    const invitee = readInvitee(ctx, row);
    return {
      id: row.id,
      channel: row.channel,
      maskedIdentifier: maskIdentifier(invitee.channel, invitee.address),
      status: invitationStatus(row, now) === "expired" ? "expired" : "pending",
      sentAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  });

  return { ok: true, institution: found, coordinators, invitations };
}

export async function removeCoordinator(
  ctx: UseCaseContext,
  input: { institutionId: string; userId: string }
): Promise<RemoveCoordinatorResult> {
  const resource = institutionResource(input.institutionId);
  await authorize(ctx, "institution.coordinators.manage", resource);
  const parsed = removeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, userId } = parsed.data;
  const grant = coordinatorGrant(institutionId);

  return ctx.db.transaction(async (tx) => {
    // Lock both users' rows in id order, as #59's role changes do, so a
    // change to either one's roles queues behind this.
    const ids = [userId];
    if (ctx.actor.kind === "user") ids.push(ctx.actor.userId);
    await tx
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, ids))
      .orderBy(asc(user.id))
      .for("no key update");
    const { role: actorRole } = await authorize(
      { db: tx, actor: ctx.actor },
      "institution.coordinators.manage",
      resource
    );

    const before = await grantsOf(tx, userId);
    const removed = await tx
      .delete(userRole)
      .where(grantRow(userId, grant))
      .returning({ id: userRole.id });
    if (removed.length === 0) return { ok: false, error: "not_found" } as const;

    const key = grantKey(grant);
    await recordAudit(tx, ctx, {
      action: "role.revoked",
      entity: { type: "user", id: userId },
      before,
      after: before.filter((held) => grantKey(held) !== key),
      actorRole,
    });
    await recordAudit(tx, ctx, {
      action: "institution.coordinator_removed",
      entity: { type: "institution", id: institutionId },
      before: { userId, role: grant.role },
      after: null,
      actorRole,
    });
    return { ok: true } as const;
  });
}

export async function revokeInvitation(
  ctx: UseCaseContext,
  input: { institutionId: string; invitationId: string }
): Promise<RevokeInvitationResult> {
  const resource = institutionResource(input.institutionId);
  await authorize(ctx, "institution.coordinators.manage", resource);
  const parsed = revokeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, invitationId } = parsed.data;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: institutionInvitation.status,
        expiresAt: institutionInvitation.expiresAt,
      })
      .from(institutionInvitation)
      .where(
        and(
          eq(institutionInvitation.id, invitationId),
          eq(institutionInvitation.institutionId, institutionId)
        )
      )
      .for("update");
    const { role: actorRole } = await authorize(
      { db: tx, actor: ctx.actor },
      "institution.coordinators.manage",
      resource
    );
    if (!row) return { ok: false, error: "not_found" } as const;
    const decision = decideInvitation("revoke", row, now);
    if (!decision.ok) return { ok: false, error: decision.reason } as const;

    await tx
      .update(institutionInvitation)
      .set({
        status: "revoked",
        revokedAt: now,
        revokedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        tokenCiphertext: null,
      })
      .where(eq(institutionInvitation.id, invitationId));
    await recordAudit(tx, ctx, {
      action: "institution.invitation_revoked",
      entity: { type: "institution", id: institutionId },
      before: { invitationId, status: "pending" },
      after: { invitationId, status: "revoked", reason: "withdrawn" },
      actorRole,
    });
    return { ok: true } as const;
  });
}
