// inviteCoordinator({ institutionId, identifier }) (#74): the authorised
// person of a verified institution invites a teacher, by email or phone, to
// coordinate for it. The invitation and its outbox event commit together;
// the message goes out when the outbox delivers the event
// (./invitation-message.ts), so the link's token is never in the outbox.
//
// Inviting the same person again withdraws the earlier link, so only the
// newest one works. Someone who already coordinates there, or the
// authorised person themselves, can't be invited.

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { grantRow } from "../../../access/grants";
import type { Actor } from "../../../actor";
import { recordAudit } from "../../../audit/record";
import type { AppDb } from "../../../db/app-db";
import {
  institution,
  institutionInvitation,
  user,
  userRole,
} from "../../../db/schema";
import { phoneHashOf } from "../../../identity/stored-phone";
import { uuidv7 } from "../../../ids";
import { invalidInput, type InvalidInput } from "../../../input";
import { emit } from "../../../outbox";
import { createLinkToken } from "../../../crypto/link-token";
import type { UseCaseContext } from "../../../use-cases";
import { invitationExpiresAt } from "../domain/invitation";
import {
  INVITATION_TOKEN,
  parseInvitee,
  storedInvitee,
  type Invitee,
} from "./invitee";

export type InviteCoordinatorInput = {
  institutionId: string;
  /** An email address or an Indian mobile number, as typed. */
  identifier: string;
};

export type InviteCoordinatorResult =
  | { ok: true; invitationId: string; expiresAt: Date }
  | InvalidInput
  | {
      ok: false;
      error:
        | "institution_not_verified"
        | "sms_disabled"
        | "already_coordinator"
        | "cannot_invite_self";
    };

const inviteInput = z.object({
  institutionId: z.uuid(),
  identifier: z.string().max(320),
});

/** The institution as a policy resource: it sits in its own scope. */
export function institutionResource(institutionId: string) {
  return { scopes: [{ type: "institution" as const, id: institutionId }] };
}

/** The account the invitee would accept with, if one exists already. */
async function existingAccount(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "blindIndex">,
  invitee: Invitee
): Promise<string | undefined> {
  const [found] = await tx
    .select({ id: user.id })
    .from(user)
    .where(
      invitee.channel === "email"
        ? eq(user.email, invitee.address)
        : eq(user.phoneHash, phoneHashOf(ctx, invitee.address))
    );
  return found?.id;
}

async function isCoordinator(
  tx: AppDb,
  userId: string,
  institutionId: string
): Promise<boolean> {
  const [held] = await tx
    .select({ id: userRole.id })
    .from(userRole)
    .where(
      grantRow(userId, {
        role: "institution_coordinator",
        scope: { type: "institution", id: institutionId },
      })
    );
  return held !== undefined;
}

function actingUserId(actor: Actor): string | null {
  return actor.kind === "user" ? actor.userId : null;
}

export async function inviteCoordinator(
  ctx: UseCaseContext,
  input: InviteCoordinatorInput
): Promise<InviteCoordinatorResult> {
  const resource = institutionResource(input.institutionId);
  await authorize(ctx, "institution.coordinators.manage", resource);
  const parsed = inviteInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId } = parsed.data;
  const invitee = parseInvitee(parsed.data.identifier);
  if (!invitee) {
    return { ok: false, error: "invalid_input", fields: ["identifier"] };
  }
  if (invitee.channel === "phone" && !(await ctx.settings.get("sms.enabled"))) {
    return { ok: false, error: "sms_disabled" };
  }
  const now = ctx.clock.now();
  const inviterId = actingUserId(ctx.actor);

  return ctx.db.transaction(async (tx) => {
    // Shared lock: a status change waits for this invite, or it sees it.
    const [target] = await tx
      .select({ status: institution.status })
      .from(institution)
      .where(eq(institution.id, institutionId))
      .for("share");
    // Again inside the transaction: a role revoked since the first check
    // counts.
    const { role: actorRole } = await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "institution.coordinators.manage",
      resource
    );
    if (target?.status !== "verified") {
      return { ok: false, error: "institution_not_verified" } as const;
    }

    const accountId = await existingAccount(tx, ctx, invitee);
    if (accountId !== undefined && accountId === inviterId) {
      return { ok: false, error: "cannot_invite_self" } as const;
    }
    if (
      accountId !== undefined &&
      (await isCoordinator(tx, accountId, institutionId))
    ) {
      return { ok: false, error: "already_coordinator" } as const;
    }

    const stored = storedInvitee(ctx, invitee);
    const superseded = await tx
      .update(institutionInvitation)
      .set({
        status: "revoked",
        revokedAt: now,
        revokedByUserId: inviterId,
        tokenCiphertext: null,
      })
      .where(
        and(
          eq(institutionInvitation.institutionId, institutionId),
          eq(institutionInvitation.identifierHash, stored.identifierHash),
          eq(institutionInvitation.status, "pending")
        )
      )
      .returning({ id: institutionInvitation.id });
    for (const { id } of superseded) {
      await recordAudit(tx, ctx, {
        action: "institution.invitation_revoked",
        entity: { type: "institution", id: institutionId },
        before: { invitationId: id, status: "pending" },
        after: { invitationId: id, status: "revoked", reason: "superseded" },
        actorRole,
      });
    }

    const { token, tokenHash } = createLinkToken();
    const invitationId = uuidv7(now);
    const expiresAt = invitationExpiresAt(now);
    await tx.insert(institutionInvitation).values({
      id: invitationId,
      institutionId,
      ...stored,
      tokenHash,
      tokenCiphertext: ctx.cipher.encrypt(INVITATION_TOKEN, token),
      invitedByUserId: inviterId,
      createdAt: now,
      expiresAt,
    });
    await emit(tx, ctx.clock, {
      type: "institution.coordinator_invited",
      aggregate: { type: "institution_invitation", id: invitationId },
      payload: { invitationId },
    });
    await recordAudit(tx, ctx, {
      action: "institution.coordinator_invited",
      entity: { type: "institution", id: institutionId },
      before: null,
      after: { invitationId, channel: invitee.channel, expiresAt },
      actorRole,
    });
    return { ok: true, invitationId, expiresAt } as const;
  });
}
