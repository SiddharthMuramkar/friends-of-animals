// A teen's guardian request (#81): a 13- to 17-year-old with no guardian on
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
//       the teen's profile becomes theirs (the teen's account its login);
//       each registration held for a guardian waits for payment once they
//       give its participation consent (#82)
//
// A child's login holds no guardian, staff, school or judge role, so it
// never adds or manages other children (./policy.ts): asking refuses an
// account that holds one, and accepting checks the teen's account again,
// under its row lock, along with their age. Nor does a minor become a
// guardian: accepting refuses an account whose own profile is a minor's
// (./own-profile.ts), under the accepter's row lock.
//
// The request is a `guardian_invitation` of kind guardian_request: its
// address and the guardian's name are encrypted, the token kept as a hash
// (plus an encrypted copy while pending, for the message). An unknown or
// malformed token is "not found", with nothing said about why.

import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
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
import { releaseHeldRegistrations } from "../consent/participation-gate";
import { canTransition } from "../registration/domain/registration-status";
import {
  GUARDIAN_RELATIONSHIPS,
  type GuardianRelationship,
} from "../registration/domain/student-details";
import { isAdultAt } from "../participants/domain/age";
import { verifiedEmailOf } from "./account-contact";
import { holdsOtherRole, isAGuardian } from "./account-roles";
import { verifiedLink } from "./child-access";
import { childDateOfBirth } from "./child-view";
import {
  decideGuardianRequest,
  decideGuardianRequestAcceptance,
  type GuardianRequestAcceptanceRefusal,
  type GuardianRequestRefusal,
} from "./domain/guardian-request";
import { guardianOfUser } from "./guardian-record";
import { ownProfileOf } from "./own-profile";
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
 * Decides, in the registering transaction (under the teen's user row
 * lock), whether and whom to ask; on success returns the write to run once
 * the teen's profile is saved. A refusal writes nothing. A new request
 * counts against the requested address's code allowance, so a teen can't
 * flood someone's inbox.
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
    requester: await rolesOf(tx, ask.requesterUserId),
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

/** What the account holds that a child's login can't. */
async function rolesOf(tx: AppDb, userId: string) {
  return {
    isAGuardian: await isAGuardian(tx, userId),
    holdsOtherRole: await holdsOtherRole(tx, userId),
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

/** The requester has reached adulthood and is continuing on their own. */
export async function revokePendingGuardianRequest(
  tx: AppDb,
  profileId: string,
  now: Date
) {
  const pending = await pendingRequestOf(tx, profileId);
  if (pending) await withdrawRequest(tx, pending.id, now);
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

type Profile = typeof participantProfile.$inferSelect;

/** Reconciles a teen's held places with the profile the guardian already keeps. */
async function claimHeldPlaces(
  tx: AppDb,
  ctx: UseCaseContext,
  source: Profile,
  target: { id: string; participantCode: string | null },
  now: Date
) {
  const held = await tx
    .select({
      id: registration.id,
      competitionId: registration.competitionId,
      status: registration.status,
    })
    .from(registration)
    .where(eq(registration.participantProfileId, source.id))
    .orderBy(registration.id)
    .for("update");
  if (held.some(({ status }) => status !== "pending_guardian")) return null;

  const existing = await tx
    .select({ competitionId: registration.competitionId })
    .from(registration)
    .where(
      and(
        eq(registration.participantProfileId, target.id),
        ne(registration.status, "withdrawn")
      )
    );
  const competitions = new Set(
    existing.map(({ competitionId }) => competitionId)
  );
  for (const row of held) {
    const duplicate = competitions.has(row.competitionId);
    if (
      duplicate &&
      !canTransition("pending_guardian", "withdrawn", "guardian")
    ) {
      throw new Error(
        "The registration machine no longer withdraws duplicate held places"
      );
    }
    await tx
      .update(registration)
      .set({
        participantProfileId: target.id,
        status: duplicate ? "withdrawn" : "pending_guardian",
        updatedAt: now,
      })
      .where(eq(registration.id, row.id));
    if (duplicate) {
      await recordAudit(tx, ctx, {
        action: "registration.status_changed",
        entity: { type: "registration", id: row.id },
        before: { status: "pending_guardian", participantProfileId: source.id },
        after: {
          status: "withdrawn",
          participantProfileId: target.id,
          cause: "guardian",
          reason: "duplicate",
        },
        actorRole: null,
      });
    }
  }
  return held.map(({ id }) => id);
}

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
      // Both accounts' rows first, the accepter's and the teen's who asked
      // (a request's requester never changes): role changes lock users
      // (#59), as do declaring as a guardian and the teen registering, so
      // the teen's roles and own profile hold still until this commits.
      const [asked] = await tx
        .select({ requesterUserId: guardianInvitation.requestedByUserId })
        .from(guardianInvitation)
        .where(
          and(
            eq(guardianInvitation.tokenHash, tokenHash),
            eq(guardianInvitation.kind, "guardian_request")
          )
        );
      await lockUsers(tx, [userId, asked?.requesterUserId ?? userId]);
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
            .select()
            .from(participantProfile)
            .where(eq(participantProfile.id, request.profileId))
            .for("update")
        : [];
      if (
        !request?.requesterUserId ||
        request.requesterUserId !== asked?.requesterUserId ||
        !profile
      ) {
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
      // Keep the profile the guardian already uses, if the match is theirs
      // to manage and it has no login to displace.
      const [sameChild] = await tx
        .select({
          id: participantProfile.id,
          loginUserId: participantProfile.loginUserId,
          participantCode: participantProfile.participantCode,
        })
        .from(participantProfile)
        .where(
          and(
            eq(participantProfile.ownerUserId, userId),
            eq(participantProfile.ownerKind, "guardian"),
            eq(participantProfile.identityHash, profile.identityHash)
          )
        )
        .for("update");
      const [activeLink] =
        sameChild && record
          ? await tx
              .select({ id: guardianLink.id })
              .from(guardianLink)
              .where(
                and(
                  eq(guardianLink.guardianId, record.id),
                  eq(guardianLink.participantProfileId, sameChild.id),
                  isNull(guardianLink.revokedAt)
                )
              )
          : [];
      const decision = decideGuardianRequestAcceptance({
        request,
        now,
        accepter: {
          isTheRequester: userId === teenUserId,
          isTheRequestedContact:
            (await verifiedContactHash(tx, ctx, userId)) ===
            request.contactHash,
          guardianVerified: record?.verifiedAt != null,
          // Under the accepter's row lock, which registering alone takes.
          ownProfile: await ownProfileOf(tx, ctx, userId, now),
        },
        childAlreadyAdded:
          sameChild !== undefined &&
          (sameChild.loginUserId !== null || !activeLink),
        requester: {
          linkedElsewhere: linkedElsewhere !== undefined,
          isAdult: isAdultAt(childDateOfBirth(ctx, profile).date, now),
          ...(await rolesOf(tx, teenUserId)),
        },
      });
      if (!decision.ok) return { ok: false, error: decision.reason };
      if (!record) throw new Error("unreachable");
      if (profile.ownerKind !== "self" || profile.ownerUserId !== teenUserId) {
        // Only a teen's own profile is ever asked about.
        throw new Error(
          `Guardian request ${request.id} is not on a teen's own profile`
        );
      }

      const childId = sameChild?.id ?? profile.id;
      let claimed: string[] = [];
      if (sameChild) {
        const places = await claimHeldPlaces(tx, ctx, profile, sameChild, now);
        if (!places) return { ok: false, error: "child_already_added" };
        claimed = places;
      } else {
        await tx
          .update(participantProfile)
          .set({
            ownerKind: "guardian",
            ownerUserId: userId,
            loginUserId: teenUserId,
            updatedAt: now,
          })
          .where(eq(participantProfile.id, childId));
        await tx.insert(guardianLink).values({
          id: uuidv7(now),
          guardianId: record.id,
          participantProfileId: childId,
          relationship,
          createdAt: now,
        });
      }
      await tx
        .update(guardianInvitation)
        .set({
          status: "accepted",
          guardianId: record.id,
          acceptedAt: now,
          acceptedByUserId: userId,
          participantProfileId: childId,
          tokenCiphertext: null,
          updatedAt: now,
        })
        .where(eq(guardianInvitation.id, request.id));
      if (sameChild) {
        // Preserve closed requests and close any pending teen-login invite.
        await tx
          .update(guardianInvitation)
          .set({ participantProfileId: childId })
          .where(eq(guardianInvitation.participantProfileId, profile.id));
        await tx
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
              eq(guardianInvitation.status, "pending"),
              eq(guardianInvitation.kind, "teen_login")
            )
          );
        await tx
          .delete(participantProfile)
          .where(eq(participantProfile.id, profile.id));
        await tx
          .update(participantProfile)
          .set({
            loginUserId: teenUserId,
            updatedAt: now,
            ...(sameChild.participantCode === null
              ? {
                  participantCode: profile.participantCode,
                  phoneCiphertext: profile.phoneCiphertext,
                  emailCiphertext: profile.emailCiphertext,
                  pinCode: profile.pinCode,
                  city: profile.city,
                  state: profile.state,
                  country: profile.country,
                  schoolName: profile.schoolName,
                }
              : {}),
          })
          .where(eq(participantProfile.id, childId));
      }
      await recordAudit(tx, ctx, {
        action: "guardian.request_accepted",
        entity: { type: "participant_profile", id: childId },
        before: {
          ownerKind: "self",
          loginUserId: null,
          participantProfileId: profile.id,
        },
        after: {
          ownerKind: "guardian",
          guardianId: record.id,
          loginUserId: teenUserId,
          requestId: request.id,
          relationship,
          claimedRegistrations: claimed,
        },
        actorRole: null,
      });
      // Held still until the guardian gives participation for each (#82).
      const released = await releaseHeldRegistrations(tx, ctx, {
        profileId: childId,
        actorRole: null,
      });
      await grantGlobalRole(tx, ctx, teenUserId, "participant");
      return { ok: true, childId, released };
    }
  );
}

/**
 * Locks the users' rows in id order, so two transactions locking the same
 * pair queue behind each other instead of deadlocking.
 */
async function lockUsers(tx: AppDb, userIds: string[]): Promise<void> {
  await tx
    .select({ id: user.id })
    .from(user)
    .where(inArray(user.id, userIds))
    .orderBy(asc(user.id))
    .for("no key update");
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
      and(eq(guardianLink.participantProfileId, profileId), verifiedLink())
    )
    .limit(1);
  return row !== undefined;
}
