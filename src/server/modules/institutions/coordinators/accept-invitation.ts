// The invitee's side of a coordinator invitation (#74):
//
//   viewInvitation({ token })    → the institution and a masked address,
//                                   for anyone holding the link
//   acceptInvitation({ token })  → the signed-in invitee becomes a
//                                   coordinator of that institution
//
// The link alone never grants anything: accepting needs an account whose
// verified email or phone is the one invited. An unknown or malformed
// token is "not found", with nothing said about why.

import { eq } from "drizzle-orm";

import { authorize } from "../../../access/can";
import { sortGrants, type Grant } from "../../../access/domain/roles";
import { grantsOf } from "../../../access/grants";
import { recordAudit } from "../../../audit/record";
import type { AppDb } from "../../../db/app-db";
import {
  institution,
  institutionInvitation,
  user,
  userRole,
} from "../../../db/schema";
import { readStoredPhone } from "../../../identity/stored-phone";
import { uuidv7 } from "../../../ids";
import {
  hashLinkToken,
  isWellFormedLinkToken,
} from "../../../crypto/link-token";
import type { UseCaseContext } from "../../../use-cases";
import {
  decideInvitation,
  invitationStatus,
  type InvitationRefusal,
  type InvitationStatus,
} from "../domain/invitation";
import { maskIdentifier, type InviteeChannel } from "../domain/mask-identifier";
import { inviteeHash, readInvitee } from "./invitee";

export type InvitationView = {
  institutionName: string;
  status: InvitationStatus;
  channel: InviteeChannel;
  /** `t***@school.test` or `***3210`: enough to recognise, no more. */
  maskedIdentifier: string;
  expiresAt: Date;
  /**
   * Whether the signed-in account's verified email or phone is the one
   * invited; null for a visitor.
   */
  forYou: boolean | null;
};

export type ViewInvitationResult =
  | { ok: true; invitation: InvitationView }
  | { ok: false; error: "not_found" };

export type AcceptInvitationResult =
  | { ok: true; institutionId: string }
  | {
      ok: false;
      error:
        | "not_found"
        | InvitationRefusal
        | "identifier_mismatch"
        | "institution_not_verified";
    };

const NOT_FOUND = { ok: false, error: "not_found" } as const;

/** The token's hash, or null for anything that can't be a link token. */
function tokenHashOf(input: { token?: unknown }): string | null {
  const { token } = input;
  return typeof token === "string" && isWellFormedLinkToken(token)
    ? hashLinkToken(token)
    : null;
}

/**
 * Whether `userId`'s verified email or phone has this blind index. Locks
 * the user's row when `lock` is set, as role changes do (#59), so a
 * concurrent change to their roles queues behind this one.
 */
async function isInvitee(
  db: AppDb,
  ctx: Pick<UseCaseContext, "cipher" | "blindIndex">,
  userId: string,
  invitation: { channel: InviteeChannel; identifierHash: string },
  lock = false
): Promise<boolean> {
  const query = db
    .select({
      email: user.email,
      emailVerified: user.emailVerified,
      phoneCiphertext: user.phoneCiphertext,
      phoneVerified: user.phoneVerified,
    })
    .from(user)
    .where(eq(user.id, userId));
  const [account] = await (lock ? query.for("no key update") : query);
  if (!account) return false;
  if (invitation.channel === "email") {
    return (
      account.emailVerified &&
      account.email !== null &&
      inviteeHash(ctx, account.email) === invitation.identifierHash
    );
  }
  return (
    account.phoneVerified &&
    account.phoneCiphertext !== null &&
    inviteeHash(ctx, readStoredPhone(ctx, account.phoneCiphertext)) ===
      invitation.identifierHash
  );
}

export async function viewInvitation(
  ctx: UseCaseContext,
  input: { token: string }
): Promise<ViewInvitationResult> {
  await authorize(ctx, "institution.invitation.view");
  const tokenHash = tokenHashOf(input);
  if (!tokenHash) return NOT_FOUND;

  const [row] = await ctx.db
    .select({
      channel: institutionInvitation.channel,
      identifierCiphertext: institutionInvitation.identifierCiphertext,
      identifierHash: institutionInvitation.identifierHash,
      status: institutionInvitation.status,
      expiresAt: institutionInvitation.expiresAt,
      institutionName: institution.name,
    })
    .from(institutionInvitation)
    .innerJoin(
      institution,
      eq(institution.id, institutionInvitation.institutionId)
    )
    .where(eq(institutionInvitation.tokenHash, tokenHash));
  if (!row) return NOT_FOUND;

  const invitee = readInvitee(ctx, row);
  return {
    ok: true,
    invitation: {
      institutionName: row.institutionName,
      status: invitationStatus(row, ctx.clock.now()),
      channel: row.channel,
      maskedIdentifier: maskIdentifier(invitee.channel, invitee.address),
      expiresAt: row.expiresAt,
      forYou:
        ctx.actor.kind === "user"
          ? await isInvitee(ctx.db, ctx, ctx.actor.userId, row)
          : null,
    },
  };
}

export async function acceptInvitation(
  ctx: UseCaseContext,
  input: { token: string }
): Promise<AcceptInvitationResult> {
  await authorize(ctx, "institution.invitation.accept");
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const { userId } = ctx.actor;
  const tokenHash = tokenHashOf(input);
  if (!tokenHash) return NOT_FOUND;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    // The row lock makes one accept win; a second waits, then reads it
    // accepted.
    const [row] = await tx
      .select({
        id: institutionInvitation.id,
        institutionId: institutionInvitation.institutionId,
        channel: institutionInvitation.channel,
        identifierHash: institutionInvitation.identifierHash,
        status: institutionInvitation.status,
        expiresAt: institutionInvitation.expiresAt,
        invitedByUserId: institutionInvitation.invitedByUserId,
        institutionStatus: institution.status,
      })
      .from(institutionInvitation)
      .innerJoin(
        institution,
        eq(institution.id, institutionInvitation.institutionId)
      )
      .where(eq(institutionInvitation.tokenHash, tokenHash))
      .for("update", { of: institutionInvitation });
    if (!row) return NOT_FOUND;

    const decision = decideInvitation("accept", row, now);
    if (!decision.ok) return { ok: false, error: decision.reason } as const;
    if (row.institutionStatus !== "verified") {
      return { ok: false, error: "institution_not_verified" } as const;
    }
    if (!(await isInvitee(tx, ctx, userId, row, true))) {
      return { ok: false, error: "identifier_mismatch" } as const;
    }

    await tx
      .update(institutionInvitation)
      .set({
        status: "accepted",
        acceptedAt: now,
        acceptedByUserId: userId,
        tokenCiphertext: null,
      })
      .where(eq(institutionInvitation.id, row.id));

    const grant: Grant = {
      role: "institution_coordinator",
      scope: { type: "institution", id: row.institutionId },
    };
    const before = await grantsOf(tx, userId);
    const [inserted] = await tx
      .insert(userRole)
      .values({
        id: uuidv7(now),
        userId,
        role: grant.role,
        scopeType: "institution",
        scopeId: row.institutionId,
        // The authorised person granted it by inviting.
        grantedByUserId: row.invitedByUserId,
        grantedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: userRole.id });
    if (inserted) {
      await recordAudit(tx, ctx, {
        action: "role.granted",
        entity: { type: "user", id: userId },
        before,
        after: sortGrants([...before, grant]),
        actorRole: null,
      });
    }
    await recordAudit(tx, ctx, {
      action: "institution.invitation_accepted",
      entity: { type: "institution", id: row.institutionId },
      before: { invitationId: row.id, status: "pending" },
      after: { invitationId: row.id, status: "accepted", userId },
      actorRole: null,
    });
    return { ok: true, institutionId: row.institutionId } as const;
  });
}
