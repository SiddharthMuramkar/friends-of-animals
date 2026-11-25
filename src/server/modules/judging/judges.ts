// Invitations are bearer links to a round, not a credential: a verified
// account with the invited email alone can accept one. Role and onboarding
// checks are fresh on each call; no judge-facing reads bypass readiness.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { sortGrants, type Grant } from "../../access/domain/roles";
import { grantsOf } from "../../access/grants";
import { recordAudit } from "../../audit/record";
import {
  createLinkToken,
  hashLinkToken,
  isWellFormedLinkToken,
} from "../../crypto/link-token";
import type { AppDb } from "../../db/app-db";
import {
  institution,
  judgeConflict,
  judgeInvitation,
  judgeOnboarding,
  judgingRound,
  roundAssignment,
  user,
  userRole,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import { emit } from "../../outbox/emit";
import { normaliseEmailAddress } from "../../ports/email";
import type { UseCaseContext } from "../../use-cases";
import { appendConsentEvent } from "../consent/consents";
import { currentConsent } from "../consent/domain/consent-state";
import { latestDocument, subjectEvents } from "../consent/repository";
import { conflictedEntryIds } from "./conflict-facts";
import {
  conflictDeclarationSchema,
  type ConflictDeclaration,
} from "./domain/conflict-declaration";
import { judgeReadiness } from "./domain/judge-readiness";
import { acceptsJudges } from "./domain/round-status";
import { actorId, authorizeRound, loadRound } from "./rounds";

export const JUDGE_EMAIL = "judge_invitation.email";
export const JUDGE_TOKEN = "judge_invitation.token";
const TTL = 14 * 24 * 60 * 60 * 1000;
const notFound = { ok: false, error: "not_found" } as const;
const closed = { ok: false, error: "round_closed" } as const;
const scope = (id: string) => ({ scopes: [{ type: "round" as const, id }] });
const pair = (roundId: string, userId: string) =>
  and(
    eq(judgeOnboarding.roundId, roundId),
    eq(judgeOnboarding.judgeUserId, userId)
  );
const rolePair = (roundId: string, userId: string) =>
  and(
    eq(userRole.role, "judge"),
    eq(userRole.scopeType, "round"),
    eq(userRole.scopeId, roundId),
    eq(userRole.userId, userId)
  );
const tokenHash = (token: string) =>
  typeof token === "string" && isWellFormedLinkToken(token)
    ? hashLinkToken(token)
    : null;
function invitationStanding(
  row: {
    status: "pending" | "accepted" | "declined" | "revoked";
    expiresAt: Date;
  },
  now: Date
): typeof row.status | "expired" {
  return row.status === "pending" && row.expiresAt <= now
    ? "expired"
    : row.status;
}
async function matchingEmail(
  ctx: UseCaseContext,
  db: AppDb,
  emailHash: string
) {
  if (ctx.actor.kind !== "user") return false;
  const [account] = await db
    .select({ email: user.email, verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, ctx.actor.userId));
  return Boolean(
    account?.verified &&
    account.email &&
    ctx.blindIndex.of(JUDGE_EMAIL, account.email) === emailHash
  );
}
export async function inviteJudge(
  ctx: UseCaseContext,
  input: { roundId: string; email: string }
) {
  const { round, role } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.manage"
  );
  const parsed = z
    .object({ roundId: z.uuid(), email: z.string().trim().max(254).email() })
    .safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!round) return notFound;
  const email = normaliseEmailAddress(parsed.data.email);
  const emailHash = ctx.blindIndex.of(JUDGE_EMAIL, email);
  return ctx.db.transaction(async (tx) => {
    const current = await loadRound(tx, round.id, true);
    if (!current || !acceptsJudges(current.status)) return closed;
    const [account] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    if (
      account &&
      (
        await tx
          .select({ id: userRole.id })
          .from(userRole)
          .where(rolePair(round.id, account.id))
      ).length
    )
      return { ok: false, error: "already_judge" } as const;
    const now = ctx.clock.now();
    const revoked = await tx
      .update(judgeInvitation)
      .set({ status: "revoked", tokenCiphertext: null, respondedAt: now })
      .where(
        and(
          eq(judgeInvitation.roundId, round.id),
          eq(judgeInvitation.emailHash, emailHash),
          eq(judgeInvitation.status, "pending")
        )
      )
      .returning({ id: judgeInvitation.id });
    for (const previous of revoked)
      await recordAudit(tx, ctx, {
        action: "judging.invitation_revoked",
        entity: { type: "judge_invitation", id: previous.id },
        before: { status: "pending" },
        after: { status: "revoked", reason: "superseded" },
        actorRole: role,
      });
    const { token, tokenHash } = createLinkToken();
    const invitationId = uuidv7(now);
    const expiresAt = new Date(now.getTime() + TTL);
    await tx.insert(judgeInvitation).values({
      id: invitationId,
      roundId: round.id,
      emailHash,
      emailCiphertext: ctx.cipher.encrypt(JUDGE_EMAIL, email),
      tokenHash,
      tokenCiphertext: ctx.cipher.encrypt(JUDGE_TOKEN, token),
      invitedByUserId: actorId(ctx),
      createdAt: now,
      expiresAt,
    });
    await emit(tx, ctx.clock, {
      type: "judging.judge_invited",
      aggregate: { type: "judge_invitation", id: invitationId },
      payload: { invitationId },
    });
    await recordAudit(tx, ctx, {
      action: "judging.judge_invited",
      entity: { type: "judge_invitation", id: invitationId },
      before: null,
      after: { roundId: round.id, expiresAt },
      actorRole: role,
    });
    return { ok: true, invitationId, expiresAt } as const;
  });
}
export async function viewJudgeInvitation(
  ctx: UseCaseContext,
  input: { token: string }
) {
  await authorize(ctx, "judge.invitation.view");
  const hash = tokenHash(input.token);
  if (!hash) return notFound;
  const [row] = await ctx.db
    .select()
    .from(judgeInvitation)
    .where(eq(judgeInvitation.tokenHash, hash));
  if (!row) return notFound;
  const round = await loadRound(ctx.db, row.roundId);
  if (!round) return notFound;
  return {
    ok: true,
    round: { id: round.id, name: round.name, level: round.level },
    status: invitationStanding(row, ctx.clock.now()),
    expiresAt: row.expiresAt,
    signedIn: ctx.actor.kind === "user",
    emailMatches: await matchingEmail(ctx, ctx.db, row.emailHash),
    roundClosed: !acceptsJudges(round.status),
  } as const;
}
async function respond(
  ctx: UseCaseContext,
  input: { token: string },
  status: "accepted" | "declined"
) {
  if (ctx.actor.kind !== "user")
    return { ok: false, error: "sign_in_required" } as const;
  await authorize(ctx, "judge.invitation.respond");
  const judgeUserId = ctx.actor.userId;
  const hash = tokenHash(input.token);
  if (!hash) return notFound;
  const [invitation] = await ctx.db
    .select({ roundId: judgeInvitation.roundId })
    .from(judgeInvitation)
    .where(eq(judgeInvitation.tokenHash, hash));
  if (!invitation) return notFound;
  return ctx.db.transaction(async (tx) => {
    // Round first, then user (role changes) and invitation, in every write.
    const round = await loadRound(tx, invitation.roundId, true);
    if (!round) return notFound;
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, judgeUserId))
      .for("no key update");
    const [row] = await tx
      .select()
      .from(judgeInvitation)
      .where(eq(judgeInvitation.tokenHash, hash))
      .for("update");
    if (!row) return notFound;
    const now = ctx.clock.now();
    const standing = invitationStanding(row, now);
    if (standing !== "pending")
      return {
        ok: false,
        error: standing === "accepted" ? "already_accepted" : standing,
      } as const;
    if (!acceptsJudges(round.status)) return closed;
    if (!(await matchingEmail(ctx, tx, row.emailHash)))
      return { ok: false, error: "email_mismatch" } as const;
    await tx
      .update(judgeInvitation)
      .set({
        status,
        respondedAt: now,
        tokenCiphertext: null,
        acceptedUserId: status === "accepted" ? judgeUserId : null,
      })
      .where(eq(judgeInvitation.id, row.id));
    if (status === "accepted") {
      const grant: Grant = {
        role: "judge",
        scope: { type: "round", id: round.id },
      };
      const before = await grantsOf(tx, judgeUserId);
      const [inserted] = await tx
        .insert(userRole)
        .values({
          id: uuidv7(now),
          userId: judgeUserId,
          role: "judge",
          scopeType: "round",
          scopeId: round.id,
          grantedAt: now,
          grantedByUserId: row.invitedByUserId,
        })
        .onConflictDoNothing()
        .returning({ id: userRole.id });
      if (inserted)
        await recordAudit(tx, ctx, {
          action: "role.granted",
          entity: { type: "user", id: judgeUserId },
          before,
          after: sortGrants([...before, grant]),
          actorRole: null,
        });
      // An invitation accepted after removal starts onboarding afresh.
      await tx.delete(judgeOnboarding).where(pair(round.id, judgeUserId));
      await tx
        .delete(judgeConflict)
        .where(
          and(
            eq(judgeConflict.roundId, round.id),
            eq(judgeConflict.judgeUserId, judgeUserId),
            eq(judgeConflict.source, "declared")
          )
        );
    }
    await recordAudit(tx, ctx, {
      action: `judging.invitation_${status}`,
      entity: { type: "judge_invitation", id: row.id },
      before: { status: "pending" },
      after: { status, roundId: round.id, judgeUserId },
      actorRole: null,
    });
    return { ok: true, roundId: round.id } as const;
  });
}
export const acceptJudgeInvitation = (
  ctx: UseCaseContext,
  input: { token: string }
) => respond(ctx, input, "accepted");
export const declineJudgeInvitation = (
  ctx: UseCaseContext,
  input: { token: string }
) => respond(ctx, input, "declined");
export async function revokeJudgeInvitation(
  ctx: UseCaseContext,
  input: { roundId: string; invitationId: string }
) {
  const { round, role } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.manage"
  );
  if (!round || !z.uuid().safeParse(input.invitationId).success)
    return notFound;
  return ctx.db.transaction(async (tx) => {
    await loadRound(tx, round.id, true);
    const [revoked] = await tx
      .update(judgeInvitation)
      .set({
        status: "revoked",
        tokenCiphertext: null,
        respondedAt: ctx.clock.now(),
      })
      .where(
        and(
          eq(judgeInvitation.roundId, round.id),
          eq(judgeInvitation.id, input.invitationId),
          eq(judgeInvitation.status, "pending")
        )
      )
      .returning({ id: judgeInvitation.id });
    if (!revoked) return notFound;
    await recordAudit(tx, ctx, {
      action: "judging.invitation_revoked",
      entity: { type: "judge_invitation", id: revoked.id },
      before: { status: "pending" },
      after: { status: "revoked" },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}
export async function removeJudge(
  ctx: UseCaseContext,
  input: { roundId: string; userId: string }
) {
  const { round, role } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.manage"
  );
  if (!round || !z.uuid().safeParse(input.userId).success) return notFound;
  return ctx.db.transaction(async (tx) => {
    const current = await loadRound(tx, round.id, true);
    if (!current || !acceptsJudges(current.status)) return closed;
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("no key update");
    const before = await grantsOf(tx, input.userId);
    const removed = await tx
      .delete(userRole)
      .where(rolePair(round.id, input.userId))
      .returning({ id: userRole.id });
    if (!removed.length) return notFound;
    await tx
      .delete(roundAssignment)
      .where(
        and(
          eq(roundAssignment.roundId, round.id),
          eq(roundAssignment.judgeUserId, input.userId)
        )
      );
    await recordAudit(tx, ctx, {
      action: "role.revoked",
      entity: { type: "user", id: input.userId },
      before,
      after: await grantsOf(tx, input.userId),
      actorRole: role,
    });
    await recordAudit(tx, ctx, {
      action: "judging.judge_removed",
      entity: { type: "judging_round", id: round.id },
      before: { judgeUserId: input.userId },
      after: null,
      actorRole: role,
    });
    return { ok: true } as const;
  });
}
export async function loadJudgeReadiness(
  db: AppDb,
  input: { roundId: string; judgeUserId: string }
) {
  const [grant] = await db
    .select({ id: userRole.id })
    .from(userRole)
    .where(rolePair(input.roundId, input.judgeUserId));
  const [row] = await db
    .select()
    .from(judgeOnboarding)
    .where(pair(input.roundId, input.judgeUserId));
  // The linked consent events are immutable; their presence records terms acceptance.
  return judgeReadiness({
    holdsRoundRole: Boolean(grant),
    conductAcceptedAt: row?.conductConsentEventId ? row.updatedAt : null,
    confidentialityAcceptedAt: row?.confidentialityConsentEventId
      ? row.updatedAt
      : null,
    conflictsDeclaredAt: row?.conflictsDeclaredAt ?? null,
  });
}
async function judgeRound(ctx: UseCaseContext, roundId: string) {
  await authorize(ctx, "judge.onboard", scope(roundId));
  return loadRound(ctx.db, roundId);
}
export async function getJudgeOnboarding(
  ctx: UseCaseContext,
  input: { roundId: string }
) {
  const round = await judgeRound(ctx, input.roundId);
  if (!round || ctx.actor.kind !== "user") return notFound;
  const judgeUserId = ctx.actor.userId;
  const [onboarding] = await ctx.db
    .select()
    .from(judgeOnboarding)
    .where(pair(round.id, judgeUserId));
  const conflicts = await ctx.db
    .select({ institutionId: judgeConflict.institutionId })
    .from(judgeConflict)
    .where(
      and(
        eq(judgeConflict.roundId, round.id),
        eq(judgeConflict.judgeUserId, judgeUserId),
        eq(judgeConflict.source, "declared")
      )
    );
  // Only institution identifiers/names, not entries or their participants.
  const institutions = await ctx.db
    .select({ id: institution.id, name: institution.name })
    .from(institution)
    .where(eq(institution.status, "verified"));
  return {
    ok: true,
    round: { id: round.id, name: round.name, status: round.status },
    readiness: await loadJudgeReadiness(ctx.db, {
      roundId: round.id,
      judgeUserId,
    }),
    conduct: await latestDocument(ctx.db, "judge_conduct"),
    confidentiality: await latestDocument(ctx.db, "judge_confidentiality"),
    declaration: {
      none: onboarding?.conflictsNone ?? false,
      statement: onboarding?.conflictStatement ?? "",
      institutionIds: conflicts.flatMap((c) =>
        c.institutionId ? [c.institutionId] : []
      ),
    },
    institutions,
  } as const;
}
export async function acceptJudgeTerms(
  ctx: UseCaseContext,
  input: {
    roundId: string;
    conductDocumentId: string;
    confidentialityDocumentId: string;
  }
) {
  const round = await judgeRound(ctx, input.roundId);
  if (!round || ctx.actor.kind !== "user") return notFound;
  const judgeUserId = ctx.actor.userId;
  return ctx.db.transaction(async (tx) => {
    const current = await loadRound(tx, round.id, true);
    if (!current || !acceptsJudges(current.status)) return closed;
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, judgeUserId))
      .for("no key update");
    await authorize({ ...ctx, db: tx }, "judge.onboard", scope(round.id));
    const conduct = await latestDocument(tx, "judge_conduct");
    const confidentiality = await latestDocument(tx, "judge_confidentiality");
    if (
      !conduct ||
      !confidentiality ||
      conduct.id !== input.conductDocumentId ||
      confidentiality.id !== input.confidentialityDocumentId
    )
      return { ok: false, error: "document_outdated" } as const;
    const [row] = await tx
      .select()
      .from(judgeOnboarding)
      .where(pair(round.id, judgeUserId));
    if (row?.conductConsentEventId && row.confidentialityConsentEventId)
      return { ok: true } as const;
    const subject = { type: "user" as const, id: judgeUserId };
    const record = async (
      purpose: "judge_conduct" | "judge_confidentiality",
      documentId: string
    ) =>
      appendConsentEvent(
        tx,
        ctx,
        currentConsent(await subjectEvents(tx, subject, purpose)),
        {
          subject,
          giverUserId: judgeUserId,
          purpose,
          documentId,
          action: "given",
          method: "web_form",
          actorRole: "judge",
        }
      );
    const conductConsentEventId = await record("judge_conduct", conduct.id);
    const confidentialityConsentEventId = await record(
      "judge_confidentiality",
      confidentiality.id
    );
    const fields = {
      conductConsentEventId,
      confidentialityConsentEventId,
      updatedAt: ctx.clock.now(),
    };
    await tx
      .insert(judgeOnboarding)
      .values({ roundId: round.id, judgeUserId, ...fields })
      .onConflictDoUpdate({
        target: [judgeOnboarding.roundId, judgeOnboarding.judgeUserId],
        set: fields,
      });
    return { ok: true } as const;
  });
}
export async function declareConflicts(
  ctx: UseCaseContext,
  input: { roundId: string; declaration: ConflictDeclaration }
) {
  const round = await judgeRound(ctx, input.roundId);
  if (!round || ctx.actor.kind !== "user") return notFound;
  const parsed = conflictDeclarationSchema.safeParse(input.declaration);
  if (!parsed.success) return invalidInput(parsed.error);
  const judgeUserId = ctx.actor.userId;
  return ctx.db.transaction(async (tx) => {
    const current = await loadRound(tx, round.id, true);
    if (!current || !acceptsJudges(current.status)) return closed;
    await authorize({ ...ctx, db: tx }, "judge.onboard", scope(round.id));
    const institutionIds = parsed.data.none ? [] : parsed.data.institutionIds;
    const statement = parsed.data.none ? null : parsed.data.statement || null;
    if (institutionIds.length) {
      const schools = await tx
        .select({ id: institution.id })
        .from(institution)
        .where(inArray(institution.id, institutionIds));
      if (schools.length !== institutionIds.length)
        return {
          ok: false,
          error: "invalid_input",
          fields: ["institutionIds"],
        } as const;
    }
    const now = ctx.clock.now();
    const fields = {
      conflictsDeclaredAt: now,
      conflictsNone: parsed.data.none,
      conflictStatement: statement,
      updatedAt: now,
    };
    await tx
      .insert(judgeOnboarding)
      .values({ roundId: round.id, judgeUserId, ...fields })
      .onConflictDoUpdate({
        target: [judgeOnboarding.roundId, judgeOnboarding.judgeUserId],
        set: fields,
      });
    await tx
      .delete(judgeConflict)
      .where(
        and(
          eq(judgeConflict.roundId, round.id),
          eq(judgeConflict.judgeUserId, judgeUserId),
          eq(judgeConflict.source, "declared")
        )
      );
    if (institutionIds.length)
      await tx.insert(judgeConflict).values(
        institutionIds.map((institutionId) => ({
          id: uuidv7(now),
          roundId: round.id,
          judgeUserId,
          institutionId,
          source: "declared" as const,
          createdAt: now,
          createdByUserId: judgeUserId,
        }))
      );
    const conflicted = [
      ...(await conflictedEntryIds(tx, round.id, judgeUserId)),
    ];
    if (conflicted.length)
      await tx
        .delete(roundAssignment)
        .where(
          and(
            eq(roundAssignment.roundId, round.id),
            eq(roundAssignment.judgeUserId, judgeUserId),
            inArray(roundAssignment.entryId, conflicted)
          )
        );
    await recordAudit(tx, ctx, {
      action: "judging.conflicts_declared",
      entity: { type: "judging_round", id: round.id },
      before: null,
      after: {
        judgeUserId,
        institutionIds,
        statementGiven: Boolean(statement),
      },
      actorRole: "judge",
    });
    return { ok: true } as const;
  });
}
export async function myJudgeRounds(ctx: UseCaseContext) {
  await authorize(ctx, "judge.rounds.list");
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const judgeUserId = ctx.actor.userId;
  const grants = await grantsOf(ctx.db, judgeUserId);
  const ids = grants.flatMap((g) =>
    g.role === "judge" && g.scope.type === "round" ? [g.scope.id] : []
  );
  const rounds = ids.length
    ? await ctx.db
        .select({
          id: judgingRound.id,
          name: judgingRound.name,
          status: judgingRound.status,
          level: judgingRound.level,
        })
        .from(judgingRound)
        .where(inArray(judgingRound.id, ids))
    : [];
  return {
    ok: true,
    rounds: await Promise.all(
      rounds.map(async (round) => ({
        round,
        readiness: await loadJudgeReadiness(ctx.db, {
          roundId: round.id,
          judgeUserId,
        }),
      }))
    ),
  } as const;
}
export async function listRoundJudges(
  ctx: UseCaseContext,
  input: { roundId: string }
) {
  const { round } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.read"
  );
  if (!round) return notFound;
  const invitations = await ctx.db
    .select()
    .from(judgeInvitation)
    .where(eq(judgeInvitation.roundId, round.id));
  const judges = await ctx.db
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(userRole)
    .innerJoin(user, eq(user.id, userRole.userId))
    .where(
      and(
        eq(userRole.role, "judge"),
        eq(userRole.scopeType, "round"),
        eq(userRole.scopeId, round.id)
      )
    );
  return {
    ok: true,
    invitations: invitations.map((i) => ({
      id: i.id,
      email: ctx.cipher.decrypt(JUDGE_EMAIL, i.emailCiphertext),
      status: invitationStanding(i, ctx.clock.now()),
      expiresAt: i.expiresAt,
    })),
    judges: await Promise.all(
      judges.map(async (j) => ({
        ...j,
        readiness: await loadJudgeReadiness(ctx.db, {
          roundId: round.id,
          judgeUserId: j.userId,
        }),
      }))
    ),
  } as const;
}
export const judgeUseCases = (ctx: UseCaseContext) => ({
  inviteJudge: (input: Parameters<typeof inviteJudge>[1]) =>
    inviteJudge(ctx, input),
  viewJudgeInvitation: (input: Parameters<typeof viewJudgeInvitation>[1]) =>
    viewJudgeInvitation(ctx, input),
  acceptJudgeInvitation: (input: Parameters<typeof acceptJudgeInvitation>[1]) =>
    acceptJudgeInvitation(ctx, input),
  declineJudgeInvitation: (
    input: Parameters<typeof declineJudgeInvitation>[1]
  ) => declineJudgeInvitation(ctx, input),
  revokeJudgeInvitation: (input: Parameters<typeof revokeJudgeInvitation>[1]) =>
    revokeJudgeInvitation(ctx, input),
  removeJudge: (input: Parameters<typeof removeJudge>[1]) =>
    removeJudge(ctx, input),
  getJudgeOnboarding: (input: Parameters<typeof getJudgeOnboarding>[1]) =>
    getJudgeOnboarding(ctx, input),
  acceptJudgeTerms: (input: Parameters<typeof acceptJudgeTerms>[1]) =>
    acceptJudgeTerms(ctx, input),
  declareConflicts: (input: Parameters<typeof declareConflicts>[1]) =>
    declareConflicts(ctx, input),
  listRoundJudges: (input: Parameters<typeof listRoundJudges>[1]) =>
    listRoundJudges(ctx, input),
  myJudgeRounds: () => myJudgeRounds(ctx),
});
