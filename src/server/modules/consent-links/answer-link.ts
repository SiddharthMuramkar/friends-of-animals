import { eq } from "drizzle-orm";

import { authorize } from "../../access/can";
import type { RequestMeta } from "../../actor";
import { recordAudit } from "../../audit/record";
import { competition, consentLink, type ConsentLink } from "../../db/schema";
import { sqlState } from "../../errors";
import type { UseCaseContext } from "../../use-cases";
import {
  appendConsentEvent,
  type ConsentEventToAppend,
} from "../consent/consents";
import {
  currentConsent,
  decideWithdraw,
} from "../consent/domain/consent-state";
import { lockProfileSubject, subjectEvents } from "../consent/repository";
import { checkAnswers } from "./domain/answers";
import { closedReason, decideAnswer } from "./domain/link";
import { offeredPublicUses, samePublicUses } from "./offered-uses";
import { sessionMatches, tokenHash, type LinkInput } from "./public-link";
import { activeLinkTarget, CLOSED_LINK_SECRETS, findLink } from "./repository";

export type AnswerConsentLinkInput = LinkInput & {
  sessionToken?: string;
  answers: Readonly<Record<string, unknown>>;
};

function answerDecision(
  ctx: UseCaseContext,
  link: ConsentLink,
  input: AnswerConsentLinkInput
) {
  return decideAnswer(
    link,
    ctx.clock.now(),
    sessionMatches(input.sessionToken, link.sessionTokenHash)
  );
}

export async function answerConsentLink(
  ctx: UseCaseContext,
  input: AnswerConsentLinkInput
) {
  await authorize(ctx, "consent_link.answer");
  const hash = tokenHash(ctx, input?.token);
  const actor = ctx.actor;
  if (!hash || actor.kind === "system")
    return { ok: false, error: "not_found" } as const;
  return saveAnswers(ctx, input, hash, actor.meta).catch((error: unknown) => {
    // Drizzle errors include bound evidence values. Report only the SQLSTATE
    // once the transaction has rolled back, before returning to the action.
    const code = sqlState(error);
    ctx.errors.report(new Error("Could not save consent link choices"), {
      where: "answerConsentLink",
      ...(code ? { tags: { sqlState: code } } : {}),
    });
    return { ok: false, error: "save_failed" } as const;
  });
}

async function saveAnswers(
  ctx: UseCaseContext,
  input: AnswerConsentLinkInput,
  hash: string,
  meta: RequestMeta
) {
  const seen = await findLink(ctx.db, hash);
  if (!seen) return { ok: false, error: "not_found" } as const;
  const initial = answerDecision(ctx, seen, input);
  if (!initial.ok) {
    const open =
      initial.reason === "not_verified" || initial.reason === "window_closed";
    const error =
      open && !(await activeLinkTarget(ctx.db, seen))
        ? "not_found"
        : initial.reason;
    return { ok: false, error } as const;
  }

  return ctx.db.transaction(async (tx) => {
    // Keep pins stable through the append. Take the competition, profile and
    // link locks in the same order as replacement sends and account consent.
    await tx
      .select({ id: competition.id })
      .from(competition)
      .where(eq(competition.id, seen.competitionId))
      .for("share");
    await lockProfileSubject(tx, seen.participantProfileId);
    const link = await findLink(tx, hash, true);
    if (!link) return { ok: false, error: "not_found" } as const;
    const closed = closedReason(link, ctx.clock.now());
    if (closed) return { ok: false, error: closed } as const;
    const target = await activeLinkTarget(tx, link, true);
    if (!target) return { ok: false, error: "not_found" } as const;
    const decision = answerDecision(ctx, link, input);
    if (!decision.ok) return { ok: false, error: decision.reason } as const;

    const offers = await offeredPublicUses(tx, target.school.competition);
    if (!samePublicUses(link.offeredUses, offers))
      return { ok: false, error: "stale_request" } as const;

    const answers = input.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return { ok: false, error: "invalid_answer" } as const;
    }
    const checked = checkAnswers(link.offeredUses, answers);
    if (!checked.ok) return { ok: false, error: checked.reason } as const;

    // The verified contact is the giver even when that browser has a session.
    const evidenceContext = {
      db: tx,
      clock: ctx.clock,
      actor: { kind: "visitor", meta } as const,
    };
    const subject = {
      type: "participant_profile",
      id: link.participantProfileId,
    } as const;
    const giver = {
      kind: "guardian_contact",
      consentLinkId: link.id,
      contactHash: link.contactHash,
    } as const;
    for (const { purpose, documentId, answer } of checked.answers) {
      const state = currentConsent(
        await subjectEvents(tx, subject, purpose, link.competitionId),
        "id"
      );
      const event =
        answer === "give"
          ? ({ kind: "record", action: "given", documentId } as const)
          : decideWithdraw(state);
      if (event.kind === "record") {
        await appendConsentEvent(tx, evidenceContext, state, {
          subject,
          purpose,
          competitionId: link.competitionId,
          action: event.action,
          documentId: event.documentId,
          method: "otp_link",
          giver,
        } satisfies ConsentEventToAppend);
      }
    }
    await tx
      .update(consentLink)
      .set({
        ...decision.patch,
        ...CLOSED_LINK_SECRETS,
        answers: Object.fromEntries(
          checked.answers.map(({ purpose, answer }) => [purpose, answer])
        ),
        updatedAt: decision.patch.usedAt,
      })
      .where(eq(consentLink.id, link.id));
    await recordAudit(
      tx,
      evidenceContext,
      {
        action: "consent_link.answered",
        entity: { type: "consent_link", id: link.id },
        before: { status: link.status },
        after: { status: "used" },
        actorRole: null,
      },
      { withoutRequestMeta: true }
    );
    return { ok: true } as const;
  });
}
