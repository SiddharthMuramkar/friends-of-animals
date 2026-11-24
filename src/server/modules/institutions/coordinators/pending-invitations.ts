// One person's invitations still waiting at one institution (#74). A
// person may be invited by email and by phone at once: each address has
// its own invitation, matched by its blind index. So when one of them is
// accepted, or the person stops coordinating, the others are withdrawn
// too. Otherwise a removed coordinator could accept a link still waiting
// and be back without a new invitation.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq, inArray } from "drizzle-orm";

import type { Role } from "../../../access/domain/roles";
import { recordAudit } from "../../../audit/record";
import type { AppDb } from "../../../db/app-db";
import { institutionInvitation, user } from "../../../db/schema";
import { readStoredPhone } from "../../../identity/stored-phone";
import type { UseCaseContext } from "../../../use-cases";
import { inviteeHash } from "./invitee";

/** Why an invitation was withdrawn without the withdraw button. */
export type WithdrawalReason =
  /** The same address was invited again: only the newest link works. */
  | "superseded"
  /** The person accepted another invitation to the institution. */
  | "accepted_another"
  /** The authorised person removed them as a coordinator. */
  | "coordinator_removed";

export const verifiedInviteeFields = {
  email: user.email,
  emailVerified: user.emailVerified,
  phoneCiphertext: user.phoneCiphertext,
  phoneVerified: user.phoneVerified,
};

export function hashesOfVerifiedInvitee(
  ctx: Pick<UseCaseContext, "cipher" | "blindIndex">,
  account: Pick<typeof user.$inferSelect, keyof typeof verifiedInviteeFields>
): string[] {
  const hashes: string[] = [];
  if (account.emailVerified && account.email !== null) {
    hashes.push(inviteeHash(ctx, account.email));
  }
  if (account.phoneVerified && account.phoneCiphertext !== null) {
    hashes.push(
      inviteeHash(ctx, readStoredPhone(ctx, account.phoneCiphertext))
    );
  }
  return hashes;
}

/**
 * The blind indexes of `userId`'s verified email and verified phone, as an
 * invitation stores its address: what they can accept, and what is
 * waiting for them.
 */
export async function verifiedInviteeHashes(
  db: AppDb,
  ctx: Pick<UseCaseContext, "cipher" | "blindIndex">,
  userId: string
): Promise<string[]> {
  const [account] = await db
    .select(verifiedInviteeFields)
    .from(user)
    .where(eq(user.id, userId));
  return account ? hashesOfVerifiedInvitee(ctx, account) : [];
}

/**
 * Withdraws the institution's pending invitations to any of
 * `identifierHashes`, by the acting user, each with an audit row. Their
 * links stop working at once: an expired one is withdrawn too.
 */
export async function withdrawPendingInvitations(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "clock" | "actor">,
  change: {
    institutionId: string;
    identifierHashes: readonly string[];
    reason: WithdrawalReason;
    actorRole: Role | null;
  }
): Promise<void> {
  if (change.identifierHashes.length === 0) return;
  const withdrawn = await tx
    .update(institutionInvitation)
    .set({
      status: "revoked",
      revokedAt: ctx.clock.now(),
      revokedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      tokenCiphertext: null,
    })
    .where(
      and(
        eq(institutionInvitation.institutionId, change.institutionId),
        inArray(institutionInvitation.identifierHash, [
          ...change.identifierHashes,
        ]),
        eq(institutionInvitation.status, "pending")
      )
    )
    .returning({ id: institutionInvitation.id });
  for (const { id } of withdrawn) {
    await recordAudit(tx, ctx, {
      action: "institution.invitation_revoked",
      entity: { type: "institution", id: change.institutionId },
      before: { invitationId: id, status: "pending" },
      after: { invitationId: id, status: "revoked", reason: change.reason },
      actorRole: change.actorRole,
    });
  }
}
