// Adult creators can withdraw their own competition-scoped public display
// and social-media permissions even after the competition ends. The child
// route stays with the verified guardian; the subject is never input here.
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { competition, consentEvent } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { invalidInput } from "../../input";
import { lockUserSubject, subjectEvents } from "./repository";
import { currentConsent, decideWithdraw } from "./domain/consent-state";
import { appendConsentEvent } from "./consents";

const PURPOSES = ["public_display", "social_media"] as const;
export type OwnPublicPurpose = (typeof PURPOSES)[number];

export async function myPublicUseConsents(ctx: UseCaseContext) {
  await authorize(ctx, "consent.view_own");
  if (ctx.actor.kind !== "user") throw new Error("Expected user");
  return ctx.db
    .selectDistinctOn([consentEvent.competitionId, consentEvent.purpose], {
      competitionId: competition.id,
      title: competition.name,
      purpose: consentEvent.purpose,
      state: consentEvent.action,
    })
    .from(consentEvent)
    .innerJoin(competition, eq(competition.id, consentEvent.competitionId))
    .where(
      and(
        eq(consentEvent.subjectType, "user"),
        eq(consentEvent.subjectId, ctx.actor.userId),
        eq(consentEvent.giverUserId, ctx.actor.userId),
        inArray(consentEvent.purpose, PURPOSES),
        isNotNull(consentEvent.competitionId)
      )
    )
    .orderBy(
      consentEvent.competitionId,
      consentEvent.purpose,
      desc(consentEvent.occurredAt),
      desc(consentEvent.id)
    )
    .then((rows) =>
      rows.filter(
        (row): row is typeof row & { purpose: OwnPublicPurpose } =>
          row.purpose === "public_display" || row.purpose === "social_media"
      )
    );
}
export async function withdrawMyPublicUseConsent(
  ctx: UseCaseContext,
  input: { competitionId: string; purpose: OwnPublicPurpose }
) {
  await authorize(ctx, "consent.withdraw");
  if (ctx.actor.kind !== "user") throw new Error("Expected user");
  const userId = ctx.actor.userId;
  const parsed = z
    .object({ competitionId: z.uuid(), purpose: z.enum(PURPOSES) })
    .safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, purpose } = parsed.data;
  const subject = { type: "user" as const, id: userId };
  return ctx.db.transaction(async (tx) => {
    await lockUserSubject(tx, userId);
    const state = currentConsent(
      await subjectEvents(tx, subject, purpose, competitionId, userId)
    );
    const decision = decideWithdraw(state);
    if (decision.kind !== "record")
      return { ok: true, changed: false } as const;
    await appendConsentEvent(tx, ctx, state, {
      subject,
      giverUserId: userId,
      purpose,
      action: "withdrawn",
      documentId: decision.documentId,
      method: "web_form",
      competitionId,
    });
    return { ok: true, changed: true } as const;
  });
}
