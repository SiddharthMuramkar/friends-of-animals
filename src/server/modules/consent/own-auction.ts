// The adult creator's auction consent is recorded at registration. They
// can withdraw their own competition-scoped consent even if the competition
// has ended or FOA changes its terms; the withdrawal never needs a new pin.
import { and, desc, eq, isNotNull, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import {
  competition,
  consentEvent,
  registration,
  participantProfile,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { invalidInput } from "../../input";
import { auctionPolicyDocument } from "./auction-policy";
import { childDateOfBirth } from "../guardians/child-view";
import { isAdultAt } from "../participants/domain/age";
import {
  lockProfileSubject,
  lockUserSubject,
  subjectEvents,
} from "./repository";
import { currentConsent, decideGive } from "./domain/consent-state";
import { appendConsentEvent } from "./consents";
import { withdrawOwnUse } from "./withdraw-own-use";

async function ownAdultRegistration(
  ctx: Pick<UseCaseContext, "db" | "clock" | "cipher">,
  userId: string,
  competitionId: string
) {
  const rows = await ctx.db
    .select({ profile: participantProfile })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(registration.participantProfileId, participantProfile.id)
    )
    .where(
      and(
        eq(registration.competitionId, competitionId),
        inArray(registration.status, ["confirmed", "enrolled"]),
        or(
          and(
            eq(participantProfile.ownerKind, "self"),
            eq(participantProfile.ownerUserId, userId)
          ),
          eq(participantProfile.loginUserId, userId)
        )
      )
    );
  for (const { profile } of rows) {
    try {
      if (isAdultAt(childDateOfBirth(ctx, profile).date, ctx.clock.now()))
        return profile.id;
    } catch {
      // Unreadable age evidence cannot authorize a grant. The creator can
      // still read and withdraw their historical consent without that evidence.
    }
  }
  return null;
}

export async function myAuctionConsents(ctx: UseCaseContext) {
  await authorize(ctx, "consent.view_own");
  if (ctx.actor.kind !== "user") throw new Error("Expected user");
  const rows = await ctx.db
    .selectDistinctOn([consentEvent.competitionId], {
      competitionId: competition.id,
      title: competition.name,
      state: consentEvent.action,
      documentId: consentEvent.documentId,
    })
    .from(consentEvent)
    .innerJoin(competition, eq(competition.id, consentEvent.competitionId))
    .where(
      and(
        eq(consentEvent.subjectType, "user"),
        eq(consentEvent.subjectId, ctx.actor.userId),
        eq(consentEvent.giverUserId, ctx.actor.userId),
        eq(consentEvent.purpose, "auction"),
        isNotNull(consentEvent.competitionId)
      )
    )
    .orderBy(
      consentEvent.competitionId,
      desc(consentEvent.occurredAt),
      desc(consentEvent.id)
    );
  const userId = ctx.actor.userId;
  return Promise.all(
    rows.map(async (row) => {
      const policy = await auctionPolicyDocument(ctx.db, row.competitionId);
      const document =
        policy?.compatible &&
        (await ownAdultRegistration(ctx, userId, row.competitionId))
          ? {
              id: policy.document.id,
              title: policy.document.title,
              version: policy.document.version,
            }
          : null;
      return {
        ...row,
        document,
        onCurrent: row.state === "given" && row.documentId === document?.id,
      };
    })
  );
}

export async function withdrawMyAuctionConsent(
  ctx: UseCaseContext,
  input: { competitionId: string }
) {
  await authorize(ctx, "consent.withdraw");
  if (ctx.actor.kind !== "user") throw new Error("Expected user");
  const parsed = z.object({ competitionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return withdrawOwnUse(ctx, parsed.data.competitionId, "auction");
}

/** Renew an adult creator's earlier scoped consent against the exact new
 * pinned economics. No caller can name a participant or another giver. */
export async function giveMyAuctionConsent(
  ctx: UseCaseContext,
  input: { competitionId: string; documentId: string }
) {
  const { role } = await authorize(ctx, "consent.give");
  if (ctx.actor.kind !== "user") throw new Error("Expected user");
  const userId = ctx.actor.userId;
  const parsed = z
    .strictObject({ competitionId: z.uuid(), documentId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, documentId } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    await tx
      .select({ id: competition.id })
      .from(competition)
      .where(eq(competition.id, competitionId))
      .for("share");
    const scoped = { ...ctx, db: tx };
    const profileId = await ownAdultRegistration(scoped, userId, competitionId);
    if (!profileId) return { ok: false, error: "not_registered" } as const;
    await lockProfileSubject(tx, profileId);
    await lockUserSubject(tx, userId);
    if (
      (await ownAdultRegistration(scoped, userId, competitionId)) !== profileId
    )
      return { ok: false, error: "not_registered" } as const;
    const subject = { type: "user" as const, id: userId };
    const state = currentConsent(
      await subjectEvents(tx, subject, "auction", competitionId, userId)
    );
    if (state.status === "never")
      return { ok: false, error: "not_registered" } as const;
    const policy = await auctionPolicyDocument(tx, competitionId);
    if (!policy?.compatible)
      return { ok: false, error: "policy_document_mismatch" } as const;
    const decision = decideGive(state, policy.document, documentId);
    if (decision.kind === "reject")
      return { ok: false, error: decision.code } as const;
    if (decision.kind === "unchanged")
      return { ok: true, changed: false } as const;
    await appendConsentEvent(tx, ctx, state, {
      subject,
      giverUserId: userId,
      purpose: "auction",
      action: "given",
      documentId: decision.documentId,
      method: "web_form",
      competitionId,
      actorRole: role,
    });
    return { ok: true, changed: true } as const;
  });
}
