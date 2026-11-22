// A 13- to 17-year-old's own login, linked to their guardian (#81):
//
//   inviteTeenLogin({ childId, email })  → the guardian invites the teen by
//       email; the invitation and its outbox event commit together, and
//       the message goes out when the outbox delivers the event
//       (./teen-invitation-message.ts), so the link's token is never in the
//       outbox. Inviting again withdraws the earlier link.
//   withdrawTeenInvitation({ childId })  → the waiting link stops working
//   viewTeenInvitation({ token })        → what the link invites to, for
//       anyone holding it: a masked address and when it expires
//   acceptTeenInvitation({ token })      → the signed-in teen's account
//       becomes the profile's login, with the participant role
//   myGuardians()                        → a teen's own guardians
//
// The link alone never grants anything: accepting needs an account whose
// verified email is the one invited; the teen's own sign-in by code proved
// it, so there is no second code. Who may accept, and when, is the pure
// decision's to say (./domain/children.ts). An unknown or malformed token
// is "not found", with nothing said about why.

import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { grantGlobalRole } from "../../access/flow-grant";
import { grantsOf } from "../../access/grants";
import { recordAudit } from "../../audit/record";
import {
  createLinkToken,
  hashLinkToken,
  isWellFormedLinkToken,
} from "../../crypto/link-token";
import type { AppDb } from "../../db/app-db";
import {
  guardian,
  guardianInvitation,
  guardianLink,
  participantProfile,
  user,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { InvalidInput } from "../../input";
import { emit } from "../../outbox";
import type { UseCaseContext } from "../../use-cases";
import {
  invitationExpiresAt,
  invitationStatus,
  type InvitationStatus,
} from "../institutions/domain/invitation";
import { maskIdentifier } from "../institutions/domain/mask-identifier";
import { ageAt } from "../participants/domain/age";
import type { GuardianRelationship } from "../registration/domain/student-details";
import { verifiedEmailOf } from "./account-contact";
import { childResource } from "./child-access";
import { childDateOfBirth } from "./child-view";
import {
  decideTeenAcceptance,
  decideTeenInvite,
  type TeenAcceptanceRefusal,
  type TeenInviteRefusal,
} from "./domain/children";
import { guardianName, guardianOfUser } from "./guardian-record";
import {
  parseTeenEmail,
  readTeenContact,
  storedTeenContact,
  teenContactHash,
  TEEN_INVITATION_TOKEN,
} from "./teen-contact";

export type InviteTeenLoginInput = { childId: string; email: string };

export type InviteTeenLoginResult =
  | { ok: true; invitationId: string; expiresAt: Date }
  | InvalidInput
  | { ok: false; error: TeenInviteRefusal };

export type WithdrawTeenInvitationResult =
  | { ok: true }
  | { ok: false; error: "no_pending_invitation" };

export type TeenInvitationView = {
  status: InvitationStatus;
  /** `a***@example.test`: enough to recognise, no more. */
  sentTo: string;
  expiresAt: Date;
  /**
   * Whether the signed-in account's verified email is the one invited;
   * null for a visitor.
   */
  forYou: boolean | null;
  /** Who invited them, shown to the invited teen only. */
  guardianName: string | null;
};

export type ViewTeenInvitationResult =
  | { ok: true; invitation: TeenInvitationView }
  | { ok: false; error: "not_found" };

export type AcceptTeenInvitationResult =
  | { ok: true; childId: string }
  | { ok: false; error: TeenAcceptanceRefusal };

export type MyGuardian = {
  fullName: string;
  relationship: GuardianRelationship;
};

const inviteInput = z.object({
  childId: z.uuid(),
  email: z.string().max(320),
});

/** The token's hash, or null for anything that can't be a link token. */
function tokenHashOf(input: { token?: unknown }): string | null {
  const { token } = input;
  return typeof token === "string" && isWellFormedLinkToken(token)
    ? hashLinkToken(token)
    : null;
}

/** The users of every guardian linked to the child right now. */
async function guardianUsersOf(tx: AppDb, childId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: guardian.userId })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(
      and(
        eq(guardianLink.participantProfileId, childId),
        isNull(guardianLink.revokedAt)
      )
    );
  return rows.map((row) => row.userId);
}

/**
 * Whether the user has declared as a guardian or holds the guardian role,
 * for any child. Read under the user's row lock, which declaring,
 * verifying and role grants also take, so none of them slips past.
 */
async function isAGuardian(tx: AppDb, userId: string): Promise<boolean> {
  if (await guardianOfUser(tx, userId)) return true;
  const grants = await grantsOf(tx, userId);
  return grants.some((grant) => grant.role === "guardian");
}

/** The child's profile, locked so invites and accepts take turns. */
async function lockedChild(tx: AppDb, childId: string) {
  const [row] = await tx
    .select({
      id: participantProfile.id,
      dobCiphertext: participantProfile.dobCiphertext,
      loginUserId: participantProfile.loginUserId,
    })
    .from(participantProfile)
    .where(
      and(
        eq(participantProfile.id, childId),
        eq(participantProfile.ownerKind, "guardian")
      )
    )
    .for("update");
  return row ?? null;
}

/**
 * Withdraws the child's waiting teen-login invitation, if any, clearing
 * its token; returns the withdrawn ids.
 */
async function withdrawPending(
  tx: AppDb,
  childId: string,
  now: Date
): Promise<string[]> {
  const rows = await tx
    .update(guardianInvitation)
    .set({
      status: "revoked",
      revokedAt: now,
      tokenCiphertext: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(guardianInvitation.participantProfileId, childId),
        eq(guardianInvitation.kind, "teen_login"),
        eq(guardianInvitation.status, "pending")
      )
    )
    .returning({ id: guardianInvitation.id });
  return rows.map((row) => row.id);
}

export async function inviteTeenLogin(
  ctx: UseCaseContext,
  input: InviteTeenLoginInput
): Promise<InviteTeenLoginResult> {
  const resource = await childResource(ctx.db, ctx.actor, input.childId);
  const { role: actorRole } = await authorize(
    ctx,
    "guardian.child.manage",
    resource
  );
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const { userId } = ctx.actor;
  const parsed = inviteInput.safeParse(input);
  const contact = parsed.success ? parseTeenEmail(parsed.data.email) : null;
  if (!parsed.success || !contact) {
    return { ok: false, error: "invalid_input", fields: ["email"] };
  }
  const { childId } = parsed.data;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx): Promise<InviteTeenLoginResult> => {
    const child = await lockedChild(tx, childId);
    // Again inside the transaction: a link revoked since the first check
    // counts.
    await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "guardian.child.manage",
      await childResource(tx, ctx.actor, childId)
    );
    if (!child) throw new Error(`Child ${childId} has a link but no profile`);
    const [record] = await tx
      .select({ id: guardian.id })
      .from(guardian)
      .where(eq(guardian.userId, userId));
    if (!record) throw new Error("A linked guardian has no guardian record");

    const [account] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, contact.address));
    const guardians = await guardianUsersOf(tx, childId);
    const decision = decideTeenInvite({
      ageYears: ageAt(childDateOfBirth(ctx, child).date, now),
      childHasLogin: child.loginUserId !== null,
      inviteeIsAGuardian:
        account !== undefined && guardians.includes(account.id),
    });
    if (!decision.ok) return { ok: false, error: decision.reason };

    const superseded = await withdrawPending(tx, childId, now);
    const { token, tokenHash } = createLinkToken();
    const invitationId = uuidv7(now);
    const expiresAt = invitationExpiresAt(now);
    await tx.insert(guardianInvitation).values({
      id: invitationId,
      kind: "teen_login",
      guardianId: record.id,
      participantProfileId: childId,
      ...storedTeenContact(ctx, contact),
      tokenHash,
      tokenCiphertext: ctx.cipher.encrypt(TEEN_INVITATION_TOKEN, token),
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    await emit(tx, ctx.clock, {
      type: "guardian.teen_invited",
      aggregate: { type: "guardian_invitation", id: invitationId },
      payload: { invitationId },
    });
    await recordAudit(tx, ctx, {
      action: "guardian.teen_invited",
      entity: { type: "participant_profile", id: childId },
      before: superseded.length > 0 ? { withdrawn: superseded } : null,
      after: { invitationId, channel: contact.channel, expiresAt },
      actorRole,
    });
    return { ok: true, invitationId, expiresAt };
  });
}

export async function withdrawTeenInvitation(
  ctx: UseCaseContext,
  input: { childId: string }
): Promise<WithdrawTeenInvitationResult> {
  const { role: actorRole } = await authorize(
    ctx,
    "guardian.child.manage",
    await childResource(ctx.db, ctx.actor, input.childId)
  );
  const now = ctx.clock.now();
  return ctx.db.transaction(
    async (tx): Promise<WithdrawTeenInvitationResult> => {
      await lockedChild(tx, input.childId);
      const withdrawn = await withdrawPending(tx, input.childId, now);
      if (withdrawn.length === 0) {
        return { ok: false, error: "no_pending_invitation" };
      }
      await recordAudit(tx, ctx, {
        action: "guardian.teen_invitation_withdrawn",
        entity: { type: "participant_profile", id: input.childId },
        before: { invitationIds: withdrawn, status: "pending" },
        after: { invitationIds: withdrawn, status: "revoked" },
        actorRole,
      });
      return { ok: true };
    }
  );
}

/** The blind index of the user's verified email, or null without one. */
async function verifiedContactHash(
  db: AppDb,
  ctx: Pick<UseCaseContext, "blindIndex">,
  userId: string
): Promise<string | null> {
  const email = await verifiedEmailOf(db, userId);
  return email === null ? null : teenContactHash(ctx, email);
}

export async function viewTeenInvitation(
  ctx: UseCaseContext,
  input: { token: string }
): Promise<ViewTeenInvitationResult> {
  await authorize(ctx, "guardian.invitation.view");
  const tokenHash = tokenHashOf(input);
  if (!tokenHash) return { ok: false, error: "not_found" };
  const [row] = await ctx.db
    .select({
      channel: guardianInvitation.channel,
      contactCiphertext: guardianInvitation.contactCiphertext,
      contactHash: guardianInvitation.contactHash,
      status: guardianInvitation.status,
      expiresAt: guardianInvitation.expiresAt,
      fullNameCiphertext: guardian.fullNameCiphertext,
    })
    .from(guardianInvitation)
    .innerJoin(guardian, eq(guardian.id, guardianInvitation.guardianId))
    .where(
      and(
        eq(guardianInvitation.tokenHash, tokenHash),
        eq(guardianInvitation.kind, "teen_login")
      )
    );
  if (!row) return { ok: false, error: "not_found" };
  const contact = readTeenContact(ctx, row);
  const forYou =
    ctx.actor.kind === "user"
      ? (await verifiedContactHash(ctx.db, ctx, ctx.actor.userId)) ===
        row.contactHash
      : null;
  return {
    ok: true,
    invitation: {
      status: invitationStatus(row, ctx.clock.now()),
      sentTo: maskIdentifier(contact.channel, contact.address),
      expiresAt: row.expiresAt,
      forYou,
      guardianName: forYou ? guardianName(ctx, row) : null,
    },
  };
}

export async function acceptTeenInvitation(
  ctx: UseCaseContext,
  input: { token: string }
): Promise<AcceptTeenInvitationResult> {
  await authorize(ctx, "guardian.invitation.accept");
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const { userId } = ctx.actor;
  const tokenHash = tokenHashOf(input);
  if (!tokenHash) return { ok: false, error: "not_found" };
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx): Promise<AcceptTeenInvitationResult> => {
    // The acceptor's row first, as role changes lock users (#59).
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("no key update");
    // The row lock makes one accept win; a second waits, then reads it
    // accepted.
    const [invitation] = await tx
      .select({
        id: guardianInvitation.id,
        childId: guardianInvitation.participantProfileId,
        contactHash: guardianInvitation.contactHash,
        status: guardianInvitation.status,
        expiresAt: guardianInvitation.expiresAt,
      })
      .from(guardianInvitation)
      .where(
        and(
          eq(guardianInvitation.tokenHash, tokenHash),
          eq(guardianInvitation.kind, "teen_login")
        )
      )
      .for("update");
    const child = invitation ? await lockedChild(tx, invitation.childId) : null;
    if (!invitation || !child) return { ok: false, error: "not_found" };

    const [otherProfile] = await tx
      .select({ id: participantProfile.id })
      .from(participantProfile)
      .where(
        and(
          eq(participantProfile.loginUserId, userId),
          ne(participantProfile.id, child.id)
        )
      );
    const decision = decideTeenAcceptance({
      invitation,
      now,
      accepter: {
        isTheInvitedContact:
          (await verifiedContactHash(tx, ctx, userId)) ===
          invitation.contactHash,
        isAGuardianOfChild: (await guardianUsersOf(tx, child.id)).includes(
          userId
        ),
        isAGuardian: await isAGuardian(tx, userId),
        linkedToAnotherChild: otherProfile !== undefined,
      },
      child: {
        ageYears: ageAt(childDateOfBirth(ctx, child).date, now),
        hasLogin: child.loginUserId !== null,
      },
    });
    if (!decision.ok) return { ok: false, error: decision.reason };

    await tx
      .update(participantProfile)
      .set({ loginUserId: userId, updatedAt: now })
      .where(eq(participantProfile.id, child.id));
    await tx
      .update(guardianInvitation)
      .set({
        status: "accepted",
        acceptedAt: now,
        acceptedByUserId: userId,
        tokenCiphertext: null,
        updatedAt: now,
      })
      .where(eq(guardianInvitation.id, invitation.id));
    await recordAudit(tx, ctx, {
      action: "guardian.teen_linked",
      entity: { type: "participant_profile", id: child.id },
      before: { loginUserId: null },
      after: { loginUserId: userId, invitationId: invitation.id },
      actorRole: null,
    });
    await grantGlobalRole(tx, ctx, userId, "participant");
    return { ok: true, childId: child.id };
  });
}

export async function myGuardians(ctx: UseCaseContext): Promise<MyGuardian[]> {
  await authorize(ctx, "guardian.mine.list");
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const rows = await ctx.db
    .select({
      fullNameCiphertext: guardian.fullNameCiphertext,
      relationship: guardianLink.relationship,
    })
    .from(participantProfile)
    .innerJoin(
      guardianLink,
      eq(guardianLink.participantProfileId, participantProfile.id)
    )
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(
      and(
        eq(participantProfile.loginUserId, ctx.actor.userId),
        isNull(guardianLink.revokedAt)
      )
    )
    .orderBy(guardianLink.createdAt);
  return rows.map((row) => ({
    fullName: guardianName(ctx, row),
    relationship: row.relationship,
  }));
}
