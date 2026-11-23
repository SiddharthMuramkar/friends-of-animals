import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { consentEvent, type ConsentFormRow } from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { UseCaseContext } from "../../use-cases";
import { latestProfileEventId } from "../consent/repository";

/** Appends the reviewed evidence under the same profile lock as #82. */
export async function recordSignedFormConsent(
  tx: AppDb,
  ctx: UseCaseContext,
  form: ConsentFormRow,
  reviewerUserId: string,
  actorRole: Role | null,
  now: Date
) {
  const lastId = await latestProfileEventId(tx, form.participantProfileId);
  const lastMs = lastId
    ? Number.parseInt(lastId.replaceAll("-", "").slice(0, 12), 16)
    : -1;
  const firstMs = Math.max(now.getTime(), lastMs + 1);
  for (const [offset, purpose] of form.uses.entries()) {
    const evidence = form.documents[purpose];
    if (!evidence) throw new Error("Signed form is missing a pinned document");
    const id = uuidv7(new Date(firstMs + offset));
    const event = {
      subjectType: "participant_profile" as const,
      subjectId: form.participantProfileId,
      purpose,
      documentId: evidence.documentId,
      competitionId: form.competitionId,
      consentFormId: form.id,
      reviewerUserId,
    };
    await tx.insert(consentEvent).values({
      id,
      ...event,
      action: "given",
      method: "paper_form",
      giverUserId: null,
      occurredAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "consent.given",
      entity: { type: "consent_event", id },
      actorRole,
      before: null,
      after: { consentEventId: id, ...event },
    });
  }
}
