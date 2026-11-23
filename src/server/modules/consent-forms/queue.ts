import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  consentDocument,
  consentForm,
  fileAsset,
  institution,
  institutionRegistration,
  participantProfile,
  user,
} from "../../db/schema";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import {
  firstNameAndInitial,
  nameParts,
} from "../consent/domain/public-credit";
import { getFileDownloadUrl } from "../files/use-cases/delivery";
import { FORM_STATUSES } from "./domain/review";
import { hasCleanScan } from "./scan";
import { consentFormsAvailable } from "./scope";

const listInput = z.object({
  status: z.enum(FORM_STATUSES).default("pending_review"),
});
const detailInput = z.object({ formId: z.uuid() });

function reviewRows(db: AppDb) {
  return db
    .select({
      form: consentForm,
      fullName: participantProfile.fullName,
      competitionName: competition.name,
      institutionName: institution.name,
      scanStatus: fileAsset.status,
      bucket: fileAsset.bucket,
      storageKey: fileAsset.storageKey,
      reviewerName: user.name,
    })
    .from(consentForm)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, consentForm.participantProfileId)
    )
    .innerJoin(competition, eq(competition.id, consentForm.competitionId))
    .innerJoin(
      institutionRegistration,
      eq(institutionRegistration.id, consentForm.institutionRegistrationId)
    )
    .innerJoin(
      institution,
      eq(institution.id, institutionRegistration.institutionId)
    )
    .innerJoin(fileAsset, eq(fileAsset.id, consentForm.fileAssetId))
    .leftJoin(user, eq(user.id, consentForm.reviewedByUserId));
}

function queueItem({
  form,
  institutionName,
  competitionName,
  fullName,
  scanStatus,
}: Awaited<ReturnType<typeof reviewRows>>[number]) {
  const { firstName, lastName } = nameParts(fullName);
  return {
    id: form.id,
    status: form.status,
    submittedAt: form.submittedAt,
    uses: form.uses,
    studentName: firstNameAndInitial(firstName, lastName),
    institutionName,
    competitionName,
    scanStatus,
  };
}

export async function listConsentFormsForReview(
  ctx: UseCaseContext,
  input: z.input<typeof listInput>
) {
  await authorize(ctx, "consent_form.read");
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!consentFormsAvailable(ctx))
    return { ok: false, error: "unavailable" } as const;
  const rows = await reviewRows(ctx.db)
    .where(eq(consentForm.status, parsed.data.status))
    .orderBy(asc(consentForm.submittedAt), asc(consentForm.id));
  return { ok: true, forms: rows.map(queueItem) } as const;
}

export async function getConsentFormForReview(
  ctx: UseCaseContext,
  input: z.input<typeof detailInput>
) {
  await authorize(ctx, "consent_form.read");
  const parsed = detailInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!consentFormsAvailable(ctx))
    return { ok: false, error: "unavailable" } as const;
  const [row] = await reviewRows(ctx.db).where(
    eq(consentForm.id, parsed.data.formId)
  );
  if (!row) return { ok: false, error: "not_found" } as const;
  const { form } = row;
  const pins = Object.values(form.documents).map(
    ({ documentId }) => documentId
  );
  const pinned =
    pins.length === 0
      ? []
      : await ctx.db
          .select({
            id: consentDocument.id,
            title: consentDocument.title,
            body: consentDocument.body,
          })
          .from(consentDocument)
          .where(inArray(consentDocument.id, pins));
  const documents = form.uses.map((purpose) => {
    const pin = form.documents[purpose];
    const document = pinned.find(({ id }) => id === pin?.documentId);
    if (!pin || !document)
      throw new Error("Signed form is missing a pinned document");
    return { purpose, ...pin, title: document.title, body: document.body };
  });
  const delivery = (await hasCleanScan(ctx.storage, {
    status: row.scanStatus,
    bucket: row.bucket,
    storageKey: row.storageKey,
  }))
    ? await getFileDownloadUrl(ctx, { fileId: form.fileAssetId })
    : null;
  return {
    ok: true,
    form: {
      ...queueItem(row),
      documents,
      download: delivery?.ok
        ? { url: delivery.url, expiresAt: delivery.expiresAt }
        : null,
      reviewedAt: form.reviewedAt,
      reviewerName: row.reviewerName,
      rejectionReason: form.rejectionReason,
      rejectionNote: form.rejectionNote,
      ownUpload:
        ctx.actor.kind === "user" && form.uploadedByUserId === ctx.actor.userId,
    },
  } as const;
}
