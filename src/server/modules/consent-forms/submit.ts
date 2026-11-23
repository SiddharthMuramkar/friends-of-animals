import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../../audit/record";
import {
  consentForm,
  consentFormUpload,
  fileAsset,
  type PinnedDocuments,
} from "../../db/schema";
import { DomainError } from "../../errors";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { PUBLIC_PURPOSES } from "../consent/domain/public-use";
import { lockProfileSubject } from "../consent/repository";
import { presignUpload } from "../files/use-cases/upload";
import { decideSubmit, decideWithdraw } from "./domain/review";
import {
  authorizeSchool,
  canCollectSchoolConsent,
  consentFormsAvailable,
  offeredFormPurposes,
  schoolScopeInput,
  schoolStudent,
  targetInput,
} from "./scope";

const uploadInput = targetInput.extend({
  contentType: z.string().max(200),
  sizeBytes: z.number(),
});
const submitInput = targetInput.extend({
  fileId: z.uuid(),
  uses: z.array(z.string().max(64)).max(PUBLIC_PURPOSES.length),
  documentIds: z.partialRecord(z.enum(PUBLIC_PURPOSES), z.uuid()).optional(),
});
const formInput = schoolScopeInput.extend({ formId: z.uuid() });

export async function requestConsentFormUpload(
  ctx: UseCaseContext,
  input: z.input<typeof uploadInput>
) {
  const parsed = uploadInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { studentId, contentType, sizeBytes } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    const { school } = await authorizeSchool(
      ctx,
      tx,
      "consent_form.submit",
      parsed.data,
      { lock: true }
    );
    if (!consentFormsAvailable(ctx))
      return { ok: false, error: "unavailable" } as const;
    if (!canCollectSchoolConsent(school))
      return { ok: false, error: "not_found" } as const;
    const student = await schoolStudent(ctx, tx, school, studentId);
    if (!student) return { ok: false, error: "not_found" } as const;
    const upload = await presignUpload(ctx, tx, {
      purpose: "consent_form",
      contentType,
      sizeBytes,
    });
    if (upload.ok)
      await tx
        .insert(consentFormUpload)
        .values({ fileAssetId: upload.fileId, registrationId: student.id });
    return upload;
  });
}

export async function submitConsentForm(
  ctx: UseCaseContext,
  input: z.input<typeof submitInput>
) {
  const parsed = submitInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { registrationId, studentId, fileId, uses, documentIds } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    const { school, userId, role } = await authorizeSchool(
      ctx,
      tx,
      "consent_form.submit",
      parsed.data,
      { lock: true }
    );
    if (!consentFormsAvailable(ctx))
      return { ok: false, error: "unavailable" } as const;
    if (!canCollectSchoolConsent(school))
      return { ok: false, error: "not_found" } as const;
    // Serialize submissions for this student, including when no form exists yet.
    // Also share the lock that orders the student's consent log.
    if (!(await schoolStudent(ctx, tx, school, studentId)))
      return { ok: false, error: "not_found" } as const;
    await lockProfileSubject(tx, studentId);
    const student = await schoolStudent(ctx, tx, school, studentId);
    if (!student) return { ok: false, error: "not_found" } as const;
    const [file] = await tx
      .select({ status: fileAsset.status })
      .from(fileAsset)
      .innerJoin(
        consentFormUpload,
        eq(consentFormUpload.fileAssetId, fileAsset.id)
      )
      .where(
        and(
          eq(fileAsset.id, fileId),
          eq(fileAsset.ownerUserId, userId),
          eq(fileAsset.purpose, "consent_form"),
          eq(consentFormUpload.registrationId, student.id)
        )
      )
      .for("update", { of: fileAsset });
    if (!file) throw new DomainError("forbidden", "May not submit this upload");
    const [alreadyUsed] = await tx
      .select({ id: consentForm.id })
      .from(consentForm)
      .where(eq(consentForm.fileAssetId, fileId));
    if (alreadyUsed) return { ok: false, error: "file_in_use" } as const;
    const [pending] = await tx
      .select({ id: consentForm.id })
      .from(consentForm)
      .where(
        and(
          eq(consentForm.participantProfileId, studentId),
          eq(consentForm.competitionId, school.competitionId),
          eq(consentForm.status, "pending_review")
        )
      );
    const offered = await offeredFormPurposes(tx, school.competitionId);
    const decision = decideSubmit({
      uses,
      offered: offered.map(({ purpose }) => purpose),
      fileStatus: file.status,
      earlier: pending ? ["pending_review"] : [],
    });
    if (!decision.ok) return { ok: false, error: decision.reason } as const;
    const approved = offered.filter(({ purpose }) =>
      decision.uses.includes(purpose)
    );
    if (
      documentIds &&
      approved.some(({ purpose, id }) => id !== documentIds[purpose])
    ) {
      return { ok: false, error: "document_outdated" } as const;
    }
    const documents: PinnedDocuments = Object.fromEntries(
      approved.map(({ purpose, id, version }) => [
        purpose,
        { documentId: id, version },
      ])
    );
    const now = ctx.clock.now();
    const formId = uuidv7(now);
    await tx.insert(consentForm).values({
      id: formId,
      participantProfileId: studentId,
      competitionId: school.competitionId,
      institutionRegistrationId: registrationId,
      fileAssetId: fileId,
      uses: approved.map(({ purpose }) => purpose),
      documents,
      uploadedByUserId: userId,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "consent_form.submitted",
      entity: { type: "consent_form", id: formId },
      actorRole: role,
      before: null,
      after: {
        status: "pending_review",
        fileId,
        studentId,
        registrationId,
        documents,
      },
    });
    return { ok: true, formId, status: "pending_review" } as const;
  });
}

export async function withdrawConsentForm(
  ctx: UseCaseContext,
  input: z.input<typeof formInput>
) {
  const parsed = formInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { formId } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    const { role, school } = await authorizeSchool(
      ctx,
      tx,
      "consent_form.withdraw",
      parsed.data
    );
    if (!consentFormsAvailable(ctx))
      return { ok: false, error: "unavailable" } as const;
    const target = and(
      eq(consentForm.id, formId),
      eq(consentForm.institutionRegistrationId, school.id),
      eq(consentForm.competitionId, school.competitionId)
    );
    const [current] = await tx
      .select({ status: consentForm.status })
      .from(consentForm)
      .where(target)
      .for("update");
    if (!current)
      throw new DomainError("forbidden", "May not withdraw this form");
    const decision = decideWithdraw(current);
    if (!decision.ok) return { ok: false, error: decision.reason } as const;
    const now = ctx.clock.now();
    await tx
      .update(consentForm)
      .set({ ...decision.patch, withdrawnAt: now, updatedAt: now })
      .where(target);
    await recordAudit(tx, ctx, {
      action: "consent_form.withdrawn",
      entity: { type: "consent_form", id: formId },
      actorRole: role,
      before: { status: current.status },
      after: decision.patch,
    });
    return { ok: true, status: "withdrawn" } as const;
  });
}
