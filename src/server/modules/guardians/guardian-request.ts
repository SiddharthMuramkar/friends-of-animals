// A teen's guardian request (81b): a 13- to 17-year-old with no guardian on
// the platform who registers for a competition names a parent or guardian,
// and FOA asks that person to verify and accept. Until a verified guardian
// accepts, the teen's registrations are held as pending_guardian.
//
//   askGuardianFor(tx, ctx, ...)   → called by registerAsIndividual in its
//       transaction: decides (./domain/guardian-request.ts) whether to send
//       a new request, replace the waiting one or reuse it, and writes the
//       request and its outbox event; the message goes out when the outbox
//       delivers the event (./guardian-request-message.ts), so the link's
//       token is never in the outbox.
//   viewGuardianRequest({ token })  → what the link asks, for anyone holding
//       it: a masked address and when it expires; the teen's name and the
//       registrations waiting only for the person asked, signed in
//   acceptGuardianRequest({ token, relationship }) → the verified guardian
//       signed in with the requested address becomes the teen's guardian:
//       the teen's profile becomes theirs (the teen's account its login),
//       and every registration held for a guardian waits for payment
//
// The request is a `guardian_invitation` of kind guardian_request: its
// address and the guardian's name are encrypted, the token kept as a hash
// (plus an encrypted copy while pending, for the message). An unknown or
// malformed token is "not found", with nothing said about why.

import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { grantGlobalRole } from "../../access/flow-grant";
import { recordAudit } from "../../audit/record";
import {
  createLinkToken,
  hashLinkToken,
  isWellFormedLinkToken,
} from "../../crypto/link-token";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  guardian,
  guardianInvitation,
  guardianLink,
  participantProfile,
  registration,
  user,
} from "../../db/schema";
import { takeCodeAllowance } from "../../identity/rate-limit";
import { uuidv7 } from "../../ids";
import { emit } from "../../outbox";
import type { UseCaseContext } from "../../use-cases";
import {
  invitationStatus,
  type InvitationStatus,
} from "../institutions/domain/invitation";
import { maskIdentifier } from "../institutions/domain/mask-identifier";
import { canTransition } from "../registration/domain/registration-status";
import {
  GUARDIAN_RELATIONSHIPS,
  type GuardianRelationship,
} from "../registration/domain/student-details";
import { verifiedEmailOf } from "./account-contact";
import {
  decideGuardianRequest,
  decideGuardianRequestAcceptance,
  type GuardianRequestAcceptanceRefusal,
  type GuardianRequestRefusal,
} from "./domain/guardian-request";
import { guardianOfUser } from "./guardian-record";
import {
  parseTeenEmail,
  readTeenContact,
  REQUESTED_GUARDIAN_NAME,
  storedTeenContact,
  teenContactHash,
  TEEN_INVITATION_TOKEN,
} from "./teen-contact";

/** A parent or guardian a teen names, as typed. */
export type GuardianDetailsInput = {
  fullName?: string;
  relationship?: string;
  email?: string;
};

/** The guardian details fields, as the register form names them. */
export type GuardianDetailsField =
  | "guardianName"
  | "guardianRelationship"
  | "guardianEmail";

export type GuardianDetails = {
  fullName: string;
  relationship: GuardianRelationship;
  email: string;
};

const name = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(2).max(100));

/**
 * The details a teen typed: null when they named nobody (every field
 * blank), else the details or the fields at fault, in the form's order.
 */
export function readGuardianDetails(
  input: GuardianDetailsInput | undefined
):
  | { ok: true; details: GuardianDetails | null }
  | { ok: false; fields: GuardianDetailsField[] } {
  const typed = {
    fullName: input?.fullName?.trim() ?? "",
    relationship: input?.relationship?.trim() ?? "",
    email: input?.email?.trim() ?? "",
  };
  if (!typed.fullName && !typed.relationship && !typed.email) {
    return { ok: true, details: null };
  }
  const fields: GuardianDetailsField[] = [];
  const fullName = name.safeParse(typed.fullName);
  if (!fullName.success) fields.push("guardianName");
  const relationship = GUARDIAN_RELATIONSHIPS.find(
    (known) => known === typed.relationship
  );
  if (!relationship) fields.push("guardianRelationship");
  const email = typed.email.length <= 320 ? parseTeenEmail(typed.email) : null;
  if (!email) fields.push("guardianEmail");
  if (!fullName.success || !relationship || !email)
    return { ok: false, fields };
  return {
    ok: true,
    details: { fullName: fullName.data, relationship, email: email.address },
  };
}

/** The child's request still waiting for an answer, locked. */
async function pendingRequestOf(tx: AppDb, profileId: string) {
  const [row] = await tx
    .select({
      id: guardianInvitation.id,
      contactHash: guardianInvitation.contactHash,
      expiresAt: guardianInvitation.expiresAt,
    })
    .from(guardianInvitation)
    .where(
      and(
        eq(guardianInvitation.participantProfileId, profileId),
        eq(guardianInvitation.kind, "guardian_request"),
        eq(guardianInvitation.status, "pending")
      )
    )
    .for("update");
  return row ?? null;
}

export type GuardianAsk = {
  /** The teen's profile, once it exists; null before the first one. */
  profileId: string | null;
  /** The teen, signed in. */
  requesterUserId: string;
  details: GuardianDetails | null;
};

export type GuardianAskDecision =
  | {
      ok: true;
      /** Writes the request (or nothing, for "reuse") for the saved profile. */
      write: (profileId: string) => Promise<void>;
    }
  | { ok: false; error: GuardianRequestRefusal | "rate_limited" };

/**
 * Decides, in the registering transaction, whether and whom to ask; on
 * success returns the write to run once the teen's profile is saved. A
 * refusal writes nothing. A new request counts against the requested
 * address's code allowance, so a teen can't flood someone's inbox.
 */
export async function askGuardianFor(
  tx: AppDb,
  ctx: UseCaseContext,
  ask: GuardianAsk
): Promise<GuardianAskDecision> {
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const now = ctx.clock.now();
  const pending = ask.profileId
    ? await pendingRequestOf(tx, ask.profileId)
    : null;
  const ownEmail = await verifiedEmailOf(tx, ask.requesterUserId);
  const decision = decideGuardianRequest({
    guardianContact: ask.details
      ? { channel: "email", address: ask.details.email }
      : null,
    ownContacts:
      ownEmail === null ? [] : [{ channel: "email", address: ownEmail }],
    pending: pending && {
      sameContact:
        ask.details !== null &&
        teenContactHash(ctx, ask.details.email) === pending.contactHash,
      expiresAt: pending.expiresAt,
    },
    now,
  });
  if (!decision.ok) return { ok: false, error: decision.reason };
  if (decision.action === "reuse") {
    return { ok: true, write: async () => {} };
  }
  const details = ask.details;
  if (!details) throw new Error("unreachable");
  const allowance = await takeCodeAllowance(tx, {
    to: { channel: "email", key: details.email },
    ip: ctx.actor.meta.ip,
    now,
    secret: ctx.auth.secret,
    limits: ctx.codeRequestLimits,
  });
  if (!allowance.ok) return { ok: false, error: "rate_limited" };

  const { expiresAt } = decision;
  return {
    ok: true,
    write: async (profileId) => {
      const withdrawn = pending
        ? await withdrawRequest(tx, pending.id, now)
        : [];
      const { token, tokenHash } = createLinkToken();
      const requestId = uuidv7(now);
      await tx.insert(guardianInvitation).values({
        id: requestId,
        kind: "guardian_request",
        guardianId: null,
        requestedByUserId: ask.requesterUserId,
        inviteeNameCiphertext: ctx.cipher.encrypt(
          REQUESTED_GUARDIAN_NAME,
          details.fullName
        ),
        relationship: details.relationship,
        participantProfileId: profileId,
        ...storedTeenContact(ctx, { channel: "email", address: details.email }),
        tokenHash,
        tokenCiphertext: ctx.cipher.encrypt(TEEN_INVITATION_TOKEN, token),
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      await emit(tx, ctx.clock, {
        type: "guardian.guardian_requested",
        aggregate: { type: "guardian_invitation", id: requestId },
        payload: { requestId },
      });
      await recordAudit(tx, ctx, {
        action: "guardian.guardian_requested",
        entity: { type: "participant_profile", id: profileId },
        before: withdrawn.length > 0 ? { withdrawn } : null,
        after: { requestId, channel: "email", expiresAt },
        actorRole: null,
      });
    },
  };
}

async function withdrawRequest(
  tx: AppDb,
  requestId: string,
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
        eq(guardianInvitation.id, requestId),
        eq(guardianInvitation.status, "pending")
      )
    )
    .returning({ id: guardianInvitation.id });
  return rows.map((row) => row.id);
}

export type GuardianRequestView = {
  status: InvitationStatus;
  /** `m***@example.test`: enough to recognise, no more. */
  sentTo: string;
  expiresAt: Date;
  /**
   * Whether the signed-in account's verified email is the one asked; null
   * for a visitor.
   */
  forYou: boolean | null;
  /**
   * Whether the person asked has verified as a guardian, which accepting
   * needs; null for anyone else.
   */
  guardianVerified: boolean | null;
  /** Who asked, and what waits: shown to the person asked only. */
  teen: {
    name: string;
    relationship: GuardianRelationship;
    competitions: string[];
  } | null;
};

export type ViewGuardianRequestResult =
  | { ok: true; request: GuardianRequestView }
  | { ok: false; error: "not_found" };

export type AcceptGuardianRequestResult =
  | { ok: true; childId: string; released: string[] }
  | { ok: false; error: GuardianRequestAcceptanceRefusal | "invalid_input" };

/** The token's hash, or null for anything that can't be a link token. */
function tokenHashOf(input: { token?: unknown }): string | null {
  const { token } = input;
  return typeof token === "string" && isWellFormedLinkToken(token)
    ? hashLinkToken(token)
    : null;
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

/** The names of the competitions the profile's registrations wait in. */
async function heldCompetitions(db: AppDb, profileId: string) {
  const rows = await db
    .select({ name: competition.name })
    .from(registration)
    .innerJoin(competition, eq(competition.id, registration.competitionId))
    .where(
      and(
        eq(registration.participantProfileId, profileId),
        eq(registration.status, "pending_guardian")
      )
    )
    .orderBy(registration.createdAt);
  return rows.map((row) => row.name);
}

export async function viewGuardianRequest(
  ctx: UseCaseContext,
  input: { token: string }
): Promise<ViewGuardianRequestResult> {
  await authorize(ctx, "guardian.request.view");
  const tokenHash = tokenHashOf(input);
  if (!tokenHash) return { ok: false, error: "not_found" };
  const [row] = await ctx.db
    .select({
      channel: guardianInvitation.channel,
      contactCiphertext: guardianInvitation.contactCiphertext,
      contactHash: guardianInvitation.contactHash,
      status: guardianInvitation.status,
      expiresAt: guardianInvitation.expiresAt,
      relationship: guardianInvitation.relationship,
      profileId: guardianInvitation.participantProfileId,
      teenName: participantProfile.fullName,
    })
    .from(guardianInvitation)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, guardianInvitation.participantProfileId)
    )
    .where(
      and(
        eq(guardianInvitation.tokenHash, tokenHash),
        eq(guardianInvitation.kind, "guardian_request")
      )
    );
  if (!row?.relationship) return { ok: false, error: "not_found" };
  const contact = readTeenContact(ctx, row);
  const forYou =
    ctx.actor.kind === "user"
      ? (await verifiedContactHash(ctx.db, ctx, ctx.actor.userId)) ===
        row.contactHash
      : null;
  const status = invitationStatus(row, ctx.clock.now());
  const record =
    forYou && ctx.actor.kind === "user"
      ? await guardianOfUser(ctx.db, ctx.actor.userId)
      : null;
  return {
    ok: true,
    request: {
      status,
      sentTo: maskIdentifier(contact.channel, contact.address),
      expiresAt: row.expiresAt,
      forYou,
      guardianVerified: forYou ? record?.verifiedAt != null : null,
      teen:
        forYou && status === "pending"
          ? {
              name: row.teenName,
              relationship: row.relationship,
              competitions: await heldCompetitions(ctx.db, row.profileId),
            }
          : null,
    },
  };
}

const acceptInput = z.object({
  token: z.string(),
  relationship: z.enum(GUARDIAN_RELATIONSHIPS),
});

export async function acceptGuardianRequest(
  ctx: UseCaseContext,
  input: { token: string; relationship: string }
): Promise<AcceptGuardianRequestResult> {
  await authorize(ctx, "guardian.request.accept");
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const { userId } = ctx.actor;
  const tokenHash = tokenHashOf(input);
  if (!tokenHash) return { ok: false, error: "not_found" };
  const parsed = acceptInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { relationship } = parsed.data;
  const now = ctx.clock.now();

  return ctx.db.transaction(
    async (tx): Promise<AcceptGuardianRequestResult> => {
      // The accepter's row first, as role changes lock users (#59).
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .for("no key update");
      // The row lock makes one accept win; a second waits, then reads it
      // accepted.
      const [request] = await tx
        .select({
          id: guardianInvitation.id,
          profileId: guardianInvitation.participantProfileId,
          requesterUserId: guardianInvitation.requestedByUserId,
          contactHash: guardianInvitation.contactHash,
          status: guardianInvitation.status,
          expiresAt: guardianInvitation.expiresAt,
        })
        .from(guardianInvitation)
        .where(
          and(
            eq(guardianInvitation.tokenHash, tokenHash),
            eq(guardianInvitation.kind, "guardian_request")
          )
        )
        .for("update");
      const [profile] = request
        ? await tx
            .select({
              id: participantProfile.id,
              ownerKind: participantProfile.ownerKind,
              ownerUserId: participantProfile.ownerUserId,
            })
            .from(participantProfile)
            .where(eq(participantProfile.id, request.profileId))
            .for("update")
        : [];
      if (!request?.requesterUserId || !profile) {
        return { ok: false, error: "not_found" };
      }
      const teenUserId = request.requesterUserId;
      const record = await guardianOfUser(tx, userId);
      const [linkedElsewhere] = await tx
        .select({ id: participantProfile.id })
        .from(participantProfile)
        .where(
          and(
            eq(participantProfile.loginUserId, teenUserId),
            ne(participantProfile.id, profile.id)
          )
        );
      const decision = decideGuardianRequestAcceptance({
        request,
        now,
        accepter: {
          isTheRequester: userId === teenUserId,
          isTheRequestedContact:
            (await verifiedContactHash(tx, ctx, userId)) ===
            request.contactHash,
          guardianVerified: record?.verifiedAt != null,
        },
        teenLinkedElsewhere: linkedElsewhere !== undefined,
      });
      if (!decision.ok) return { ok: false, error: decision.reason };
      if (!record) throw new Error("unreachable");
      if (profile.ownerKind !== "self" || profile.ownerUserId !== teenUserId) {
        // Only a teen's own profile is ever asked about.
        throw new Error(
          `Guardian request ${request.id} is not on a teen's own profile`
        );
      }

      await tx
        .update(participantProfile)
        .set({
          ownerKind: "guardian",
          ownerUserId: userId,
          loginUserId: teenUserId,
          updatedAt: now,
        })
        .where(eq(participantProfile.id, profile.id));
      await tx.insert(guardianLink).values({
        id: uuidv7(now),
        guardianId: record.id,
        participantProfileId: profile.id,
        relationship,
        createdAt: now,
      });
      await tx
        .update(guardianInvitation)
        .set({
          status: "accepted",
          guardianId: record.id,
          acceptedAt: now,
          acceptedByUserId: userId,
          tokenCiphertext: null,
          updatedAt: now,
        })
        .where(eq(guardianInvitation.id, request.id));
      await recordAudit(tx, ctx, {
        action: "guardian.request_accepted",
        entity: { type: "participant_profile", id: profile.id },
        before: { ownerKind: "self", loginUserId: null },
        after: {
          ownerKind: "guardian",
          guardianId: record.id,
          loginUserId: teenUserId,
          requestId: request.id,
          relationship,
        },
        actorRole: null,
      });
      const released = await releaseHeldRegistrations(tx, ctx, profile.id);
      await grantGlobalRole(tx, ctx, teenUserId, "participant");
      return { ok: true, childId: profile.id, released };
    }
  );
}

/**
 * Every registration of the profile held for a guardian now waits for its
 * fee, each with its audit entry; returns their ids.
 */
async function releaseHeldRegistrations(
  tx: AppDb,
  ctx: UseCaseContext,
  profileId: string
): Promise<string[]> {
  if (!canTransition("pending_guardian", "pending_payment", "guardian")) {
    throw new Error("The registration machine no longer releases held ones");
  }
  const held = await tx
    .select({ id: registration.id })
    .from(registration)
    .where(
      and(
        eq(registration.participantProfileId, profileId),
        eq(registration.status, "pending_guardian")
      )
    )
    .orderBy(registration.id)
    .for("update");
  const ids = held.map((row) => row.id);
  if (ids.length === 0) return [];
  await tx
    .update(registration)
    .set({ status: "pending_payment", updatedAt: ctx.clock.now() })
    .where(inArray(registration.id, ids));
  for (const id of ids) {
    await recordAudit(tx, ctx, {
      action: "registration.status_changed",
      entity: { type: "registration", id },
      before: { status: "pending_guardian" },
      after: { status: "pending_payment", cause: "guardian" },
      actorRole: null,
    });
  }
  return ids;
}

/** Whether an active link joins the profile to a verified guardian. */
export async function hasVerifiedGuardian(
  db: AppDb,
  profileId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: guardianLink.id })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(
      and(
        eq(guardianLink.participantProfileId, profileId),
        isNull(guardianLink.revokedAt),
        isNotNull(guardian.verifiedAt)
      )
    )
    .limit(1);
  return row !== undefined;
}
