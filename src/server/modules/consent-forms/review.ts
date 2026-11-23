import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import {
  consentForm,
  fileAsset,
  institutionRegistration,
} from "../../db/schema";
import { invalidInput } from "../../input";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import { lockProfileSubject } from "../consent/repository";
import { decideReview } from "./domain/review";
import { recordSignedFormConsent } from "./record";
import { hasCleanScan } from "./scan";
import { consentFormsAvailable, schoolStudent } from "./scope";

const reviewInput = z.discriminatedUnion("decision", [
  z.object({ formId: z.uuid(), decision: z.literal("accept") }),
  z.object({
    formId: z.uuid(),
    decision: z.literal("reject"),
    reason: z.string().max(64),
    note: z.string().max(2000).optional(),
  }),
]);

export async function reviewConsentForm(
  ctx: UseCaseContext,
  input: z.input<typeof reviewInput>
) {
  await authorize(ctx, "consent_form.review");
  const parsed = reviewInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!consentFormsAvailable(ctx))
    return { ok: false, error: "unavailable" } as const;
  const { formId, decision } = parsed.data;
  if (ctx.actor.kind !== "user") throw new Error("Expected a staff account");
  const reviewerId = ctx.actor.userId;
  return ctx.db.transaction(async (tx) => {
    const [found] = await tx
      .select({ studentId: consentForm.participantProfileId })
      .from(consentForm)
      .where(eq(consentForm.id, formId));
    if (!found) return { ok: false, error: "not_found" } as const;
    await lockProfileSubject(tx, found.studentId);
    const { role } = await authorize({ ...ctx, db: tx }, "consent_form.review");
    const [form] = await tx
      .select()
      .from(consentForm)
      .where(eq(consentForm.id, formId))
      .for("update");
    if (!form) return { ok: false, error: "not_found" } as const;
    const [file] = await tx
      .select({
        status: fileAsset.status,
        bucket: fileAsset.bucket,
        storageKey: fileAsset.storageKey,
      })
      .from(fileAsset)
      .where(eq(fileAsset.id, form.fileAssetId))
      .for("update");
    const now = ctx.clock.now();
    const review = decideReview(
      {
        form: { status: form.status, uploadedBy: form.uploadedByUserId },
        reviewerId,
        fileStatus: file?.status ?? "deleted",
        now,
      },
      parsed.data.decision === "reject"
        ? { kind: "reject", reason: parsed.data.reason, note: parsed.data.note }
        : { kind: "accept" }
    );
    if (!review.ok) return { ok: false, error: review.reason } as const;
    if (decision === "accept") {
      if (!(await hasCleanScan(ctx.storage, file)))
        return { ok: false, error: "file_unavailable" } as const;
      const [school] = await tx
        .select()
        .from(institutionRegistration)
        .where(eq(institutionRegistration.id, form.institutionRegistrationId));
      if (
        !school ||
        !(await schoolStudent(ctx, tx, school, form.participantProfileId))
      ) {
        return { ok: false, error: "no_longer_enrolled" } as const;
      }
      await recordSignedFormConsent(tx, ctx, form, reviewerId, role, now);
    } else {
      await emit(tx, ctx.clock, {
        type: "consent.form_reviewed",
        aggregate: { type: "consent_form", id: formId },
        payload: { formId, uploaderUserId: form.uploadedByUserId },
      });
    }
    const { status, reviewedBy, reviewedAt, rejectionReason, rejectionNote } =
      review.patch;
    await tx
      .update(consentForm)
      .set({
        status,
        reviewedByUserId: reviewedBy,
        reviewedAt,
        rejectionReason,
        rejectionNote,
        updatedAt: now,
      })
      .where(eq(consentForm.id, formId));
    await recordAudit(tx, ctx, {
      action: `consent_form.${status}`,
      entity: { type: "consent_form", id: formId },
      actorRole: role,
      before: { status: form.status },
      after: { status, reviewedBy, rejectionReason },
    });
    return { ok: true, status } as const;
  });
}
