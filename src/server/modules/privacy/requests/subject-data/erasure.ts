// Erasure (#115b).
//
//   previewErasure({ id })                  the grievance officer sees what
//                                           erasure would delete, anonymise
//                                           and keep, and why; writes nothing
//   executeErasure({ id, fingerprint })     the officer approves exactly that
//                                           plan, with a fresh second factor
//   privacy.execute_erasure                 the worker carries it out, or
//                                           refuses if the plan changed
//
// The plan's rules are in ./erasure-plan.ts; this file finds the records
// (`gatherErasure`) and changes them (`eraseRecords`). The job deletes
// stored files first (deleting a missing object is fine), then, in one
// transaction, withdraws consents, deletes and anonymises rows, writes the
// erasure record and completes the request. A retry plans again: what is
// already gone isn't found, so nothing happens twice.
//
// Carrying out an erasure is off until counsel rules on what it must keep
// (setting privacy.erasureEnabled, HR-30); previewing is always allowed.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../../access/can";
import type { Actor } from "../../../../actor";
import { recordAudit } from "../../../../audit/record";
import type { FieldCipher } from "../../../../crypto/field-cipher";
import type { AppDb } from "../../../../db/app-db";
import {
  account,
  auditLog,
  artworkPhoto,
  physicalArtwork,
  roundEntry,
  roundAssignment,
  judgeConflict,
  consentDocument,
  consentEvent,
  consentForm,
  consentFormUpload,
  consentLink,
  directoryListing,
  entry,
  entryFile,
  entryUploadGrant,
  erasureRecord,
  fileAsset,
  fileDerivative,
  fileProcessing,
  guardian,
  guardianInvitation,
  guardianLink,
  inboxItem,
  institution,
  messageDelivery,
  messageTemplate,
  notificationPreference,
  participantProfile,
  paymentBatch,
  paymentBatchItem,
  privacyRequest,
  refundItem,
  registration,
  secondFactor,
  secondFactorLockout,
  session,
  user,
  userRole,
  type PrivacyRequestRow,
} from "../../../../db/schema";
import { uuidv7 } from "../../../../ids";
import { invalidInput, type InvalidInput } from "../../../../input";
import { emit, type OutboxDeps } from "../../../../outbox";
import type { EmailSender } from "../../../../ports/email";
import type { ErrorReporter } from "../../../../ports/errors";
import type { ObjectStorage } from "../../../../ports/storage";
import type { UseCaseContext } from "../../../../use-cases";
import { appendConsentEvent } from "../../../consent/consents";
import {
  currentConsent,
  type ConsentState,
} from "../../../consent/domain/consent-state";
import {
  WITHDRAWABLE_PURPOSES,
  type WithdrawablePurpose,
} from "../../../consent/domain/purposes";
import {
  lockProfileSubject,
  lockUserSubject,
  type ConsentSubject,
} from "../../../consent/repository";
import {
  donationErasureTargets,
  prepareDonationErasure,
  confirmDonationErasure,
  withdrawDonationRecognition,
} from "../../../donations/erasure";
import { eraseOwnedListings } from "../../../directory/erase-owner";
import {
  renderEmailHtml,
  renderTemplate,
} from "../../../notifications/domain/template";
import { PROFILE_PURPOSE } from "../../../registration/student-profile";
import { readSetting } from "../../../settings/read";
import { TOMBSTONE } from "../../domain/anonymise";
import { FINANCIAL_FLOOR } from "../../domain/periods";
import { floorLapsesAt } from "../../domain/retention-period";
import { activeLegalHolds } from "../../holds";
import { lastActivity } from "../../policies/financial";
import { privacyRequestAuditSnapshot } from "../domain/audit";
import { decideRequestTransition } from "../domain/request-status";
import { requestValues } from "../messages";
import { lockSubject } from "../submit";
import { lockRequest, NOT_FOUND, withOfficer } from "../with-officer";
import {
  planErasure,
  retainedCategories,
  retainedUntil,
  type AccountKeeper,
  type ErasureFacts,
  type ErasurePlan,
} from "./erasure-plan";
import { subjectScope, type SubjectScope } from "./scope";
import { within } from "./sections";

/**
 * What an anonymised profile's date of birth reads as: a placeholder, not
 * a date of birth. The column is encrypted and required, so it can't be
 * blanked.
 */
export const ERASED_DATE_OF_BIRTH = "1900-01-01";

const WORKER: Actor = { kind: "system", process: "worker" };

type StoredObject = { bucket: string; key: string };

type ConsentToWithdraw = {
  subject: ConsentSubject;
  purpose: WithdrawablePurpose;
  competitionId: string | null;
  state: ConsentState;
};

/** The person's records, found, with what binds each. */
export type ErasureTargets = {
  scope: SubjectScope;
  facts: ErasureFacts;
  donations: Awaited<ReturnType<typeof donationErasureTargets>>;
  users: string[];
  consents: ConsentToWithdraw[];
  entryIds: string[];
  /** File assets the erasure deletes: entry uploads and own test uploads. */
  fileIds: string[];
  objects: StoredObject[];
  registrations: { free: string[]; kept: string[] };
  profiles: { delete: string[]; anonymise: string[] };
};

const isWithdrawable = (purpose: string): purpose is WithdrawablePurpose =>
  (WITHDRAWABLE_PURPOSES as readonly string[]).includes(purpose);

/** The `n` of a one-row count query. */
async function rowsCount(query: Promise<{ n: number }[]>): Promise<number> {
  const [row] = await query;
  return row?.n ?? 0;
}

/** Consents still given, per purpose and competition, for each subject. */
async function givenConsents(
  db: AppDb,
  scope: SubjectScope
): Promise<ConsentToWithdraw[]> {
  const subjects: ConsentSubject[] = [
    ...scope.userIds.map((id) => ({ type: "user" as const, id })),
    ...scope.profileIds.map((id) => ({
      type: "participant_profile" as const,
      id,
    })),
  ];
  const found: ConsentToWithdraw[] = [];
  for (const subject of subjects) {
    const events = await db
      .select({
        id: consentEvent.id,
        action: consentEvent.action,
        documentId: consentEvent.documentId,
        documentVersion: consentDocument.version,
        occurredAt: consentEvent.occurredAt,
        purpose: consentEvent.purpose,
        competitionId: consentEvent.competitionId,
      })
      .from(consentEvent)
      .innerJoin(
        consentDocument,
        eq(consentDocument.id, consentEvent.documentId)
      )
      .where(
        and(
          eq(consentEvent.subjectType, subject.type),
          eq(consentEvent.subjectId, subject.id)
        )
      );
    const byPurpose = new Map<string, typeof events>();
    for (const event of events) {
      const key = `${event.purpose}|${event.competitionId ?? ""}`;
      byPurpose.set(key, [...(byPurpose.get(key) ?? []), event]);
    }
    for (const group of byPurpose.values()) {
      const { purpose, competitionId } = group[0]!;
      if (!isWithdrawable(purpose)) continue;
      const state = currentConsent(
        group,
        subject.type === "participant_profile" ? "id" : "occurredAt"
      );
      if (state.status === "given") {
        found.push({ subject, purpose, competitionId, state });
      }
    }
  }
  return found;
}

/** Why the account must stay, if it must; null when it can go. */
async function accountKeeper(
  db: AppDb,
  users: readonly string[],
  deletedFileIds: readonly string[],
  keepPayer: boolean,
  now: Date
): Promise<AccountKeeper | null> {
  if (users.length === 0) return null;
  if (keepPayer) {
    const paid = await db
      .select({ lastActivity })
      .from(paymentBatch)
      .where(within(paymentBatch.payerUserId, users));
    const lapses = paid
      .map((batch) => floorLapsesAt(batch.lastActivity, FINANCIAL_FLOOR))
      .filter((at) => at > now)
      .map((at) => at.getTime());
    if (lapses.length > 0) {
      return { basis: "financial_floor", until: new Date(Math.max(...lapses)) };
    }
  }
  const [registered] = await db
    .select({ n: count() })
    .from(institution)
    .where(within(institution.createdBy, users));
  if ((registered?.n ?? 0) > 0) {
    return { basis: "institution_record", until: null };
  }
  const evidence =
    (await rowsCount(
      db
        .select({ n: count() })
        .from(consentForm)
        .where(
          sql`${within(consentForm.uploadedByUserId, users)} OR ${within(consentForm.reviewedByUserId, users)}`
        )
    )) +
    (await rowsCount(
      db
        .select({ n: count() })
        .from(consentEvent)
        .where(within(consentEvent.reviewerUserId, users))
    ));
  if (evidence > 0) return { basis: "consent_proof", until: null };
  const owned = await db
    .select({ id: fileAsset.id })
    .from(fileAsset)
    .where(within(fileAsset.ownerUserId, users));
  const deleted = new Set(deletedFileIds);
  if (owned.some((file) => !deleted.has(file.id))) {
    return { basis: "linked_records", until: null };
  }
  return null;
}

/** Every stored object of these file assets: originals and derivatives. */
async function objectsOf(
  db: AppDb,
  fileIds: readonly string[]
): Promise<StoredObject[]> {
  if (fileIds.length === 0) return [];
  const originals = await db
    .select({ bucket: fileAsset.bucket, key: fileAsset.storageKey })
    .from(fileAsset)
    .where(inArray(fileAsset.id, [...fileIds]));
  const derivatives = await db
    .select({ bucket: fileDerivative.bucket, key: fileDerivative.storageKey })
    .from(fileDerivative)
    .where(inArray(fileDerivative.fileAssetId, [...fileIds]));
  return [...originals, ...derivatives];
}

/** Finds the person's records and counts what the plan decides on. */
export async function gatherErasure(
  db: AppDb,
  request: Pick<PrivacyRequestRow, "subjectKind" | "subjectId">,
  now: Date
): Promise<ErasureTargets> {
  const scope = await subjectScope(db, request);
  const users = (
    await db
      .select({ id: user.id })
      .from(user)
      .where(within(user.id, scope.userIds))
  ).map((row) => row.id);
  const profileIds = (
    await db
      .select({ id: participantProfile.id })
      .from(participantProfile)
      .where(within(participantProfile.id, scope.profileIds))
  ).map((row) => row.id);
  const live: SubjectScope = { userIds: users, profileIds };

  const holds = await activeLegalHolds(db);
  const onLegalHold = holds.some(
    (hold) =>
      (hold.subjectType === "user" && users.includes(hold.subjectId)) ||
      (hold.subjectType === "participant_profile" &&
        profileIds.includes(hold.subjectId))
  );

  const consents = await givenConsents(db, live);
  const n = (query: Promise<{ n: number }[]>) => rowsCount(query);

  const entryRows = await db
    .select({ id: entry.id })
    .from(entry)
    .where(within(entry.participantProfileId, profileIds));
  const entryIds = entryRows.map((row) => row.id);
  const registrationRows = await db
    .select({
      id: registration.id,
      profileId: registration.participantProfileId,
    })
    .from(registration)
    .where(within(registration.participantProfileId, profileIds));
  const registrationIds = registrationRows.map((row) => row.id);

  const entryFileIds = [
    ...(
      await db
        .select({ id: entryFile.fileAssetId })
        .from(entryFile)
        .where(
          and(
            within(entryFile.entryId, entryIds),
            isNotNull(entryFile.fileAssetId)
          )
        )
    ).map((row) => row.id!),
    ...(
      await db
        .select({ id: entryUploadGrant.fileAssetId })
        .from(entryUploadGrant)
        .where(within(entryUploadGrant.registrationId, registrationIds))
    ).map((row) => row.id),
  ];
  const artworkFileIds = (
    await db
      .select({ id: artworkPhoto.fileAssetId })
      .from(artworkPhoto)
      .innerJoin(
        physicalArtwork,
        eq(physicalArtwork.id, artworkPhoto.artworkId)
      )
      .where(within(physicalArtwork.entryId, entryIds))
  ).map((row) => row.id);
  const uploadIds = (
    await db
      .select({ id: fileAsset.id })
      .from(fileAsset)
      .where(
        and(
          within(fileAsset.ownerUserId, users),
          inArray(fileAsset.purpose, ["test_upload", "directory_document"])
        )
      )
  ).map((row) => row.id);
  const fileIds = [
    ...new Set([...entryFileIds, ...artworkFileIds, ...uploadIds]),
  ];

  // A registration a payment, a refund or consent evidence names stays.
  const paidRegistrations = new Set(
    [
      ...(await db
        .select({ id: paymentBatchItem.registrationId })
        .from(paymentBatchItem)
        .where(within(paymentBatchItem.registrationId, registrationIds))),
      ...(await db
        .select({ id: refundItem.registrationId })
        .from(refundItem)
        .where(within(refundItem.registrationId, registrationIds))),
    ].map((row) => row.id)
  );
  const evidencedRegistrations = new Set(
    [
      ...(await db
        .select({ id: consentLink.studentRegistrationId })
        .from(consentLink)
        .where(within(consentLink.studentRegistrationId, registrationIds))),
      ...(await db
        .select({ id: consentFormUpload.registrationId })
        .from(consentFormUpload)
        .where(within(consentFormUpload.registrationId, registrationIds))),
    ].map((row) => row.id)
  );
  const keptRegistrations = registrationIds.filter(
    (id) => paidRegistrations.has(id) || evidencedRegistrations.has(id)
  );
  const freeRegistrations = registrationIds.filter(
    (id) => !keptRegistrations.includes(id)
  );

  const evidencedProfiles = new Set(
    [
      ...(await db
        .select({ id: consentForm.participantProfileId })
        .from(consentForm)
        .where(within(consentForm.participantProfileId, profileIds))),
      ...(await db
        .select({ id: consentLink.participantProfileId })
        .from(consentLink)
        .where(within(consentLink.participantProfileId, profileIds))),
    ].map((row) => row.id)
  );
  const keptByRegistration = new Set(
    registrationRows
      .filter((row) => keptRegistrations.includes(row.id))
      .map((row) => row.profileId)
  );
  const keptProfiles = profileIds.filter(
    (id) => keptByRegistration.has(id) || evidencedProfiles.has(id)
  );
  const deletableProfiles = profileIds.filter(
    (id) => !keptProfiles.includes(id)
  );
  const paidProfiles = new Set(
    registrationRows
      .filter((row) => paidRegistrations.has(row.id))
      .map((row) => row.profileId)
  );

  const batches = await db
    .select({ id: paymentBatch.id, lastActivity })
    .from(paymentBatch)
    .where(
      sql`${within(paymentBatch.payerUserId, users)} OR ${paymentBatch.id} IN (SELECT ${paymentBatchItem.batchId} FROM ${paymentBatchItem} WHERE ${within(paymentBatchItem.registrationId, registrationIds)})`
    );
  const lapses = batches.map((batch) =>
    floorLapsesAt(batch.lastActivity, FINANCIAL_FLOOR).getTime()
  );

  // Read through `db`: inside a transaction, the settings port's own
  // connection would wait for it.
  const keepPayer = await readSetting(db, "privacy.erasureKeepsPayerAccount");
  const donations = await donationErasureTargets(db, users);
  const facts: ErasureFacts = {
    onLegalHold,
    donorRecognition: donations.donorIds.length,
    recurringMandates: donations.mandateIds.length,
    donationRecords: donations.records,
    givenConsents: consents.length,
    accounts: users.length,
    accountKeeper: await accountKeeper(db, users, fileIds, keepPayer, now),
    signIn:
      (await n(
        db
          .select({ n: count() })
          .from(session)
          .where(within(session.userId, users))
      )) +
      (await n(
        db
          .select({ n: count() })
          .from(account)
          .where(within(account.userId, users))
      )) +
      (await n(
        db
          .select({ n: count() })
          .from(secondFactor)
          .where(within(secondFactor.userId, users))
      )),
    roles: await n(
      db
        .select({ n: count() })
        .from(userRole)
        .where(within(userRole.userId, users))
    ),
    messages:
      (await n(
        db
          .select({ n: count() })
          .from(inboxItem)
          .where(within(inboxItem.userId, users))
      )) +
      (await n(
        db
          .select({ n: count() })
          .from(messageDelivery)
          .where(within(messageDelivery.userId, users))
      )) +
      (await n(
        db
          .select({ n: count() })
          .from(notificationPreference)
          .where(within(notificationPreference.userId, users))
      )),
    guardianRecords:
      (await n(
        db
          .select({ n: count() })
          .from(guardian)
          .where(within(guardian.userId, users))
      )) +
      (await n(
        db
          .select({ n: count() })
          .from(guardianInvitation)
          .where(within(guardianInvitation.requestedByUserId, users))
      )),
    uploads: uploadIds.length,
    entries: entryIds.length,
    freeRegistrations: freeRegistrations.length,
    keptRegistrations: keptRegistrations.length,
    guardianLinks:
      (await n(
        db
          .select({ n: count() })
          .from(guardianLink)
          .where(within(guardianLink.participantProfileId, profileIds))
      )) +
      (await n(
        db
          .select({ n: count() })
          .from(guardianInvitation)
          .where(within(guardianInvitation.participantProfileId, profileIds))
      )),
    directoryListings: await n(
      db
        .select({ n: count() })
        .from(directoryListing)
        .where(within(directoryListing.ownerUserId, users))
    ),
    directoryPublications: await n(
      db
        .select({ n: count() })
        .from(directoryListing)
        .where(
          and(
            within(directoryListing.ownerUserId, users),
            inArray(directoryListing.status, [
              "pending_verification",
              "verified",
              "suspended",
            ])
          )
        )
    ),
    deletableProfiles: deletableProfiles.length,
    keptProfiles: keptProfiles.length,
    keptProfileBasis: keptProfiles.some((id) => paidProfiles.has(id))
      ? "financial_record"
      : "consent_proof",
    payments: batches.length,
    paymentsUntil: lapses.length > 0 ? new Date(Math.max(...lapses)) : null,
    children: await n(
      db
        .select({ n: count() })
        .from(participantProfile)
        .where(
          and(
            within(participantProfile.ownerUserId, users),
            eq(participantProfile.ownerKind, "guardian")
          )
        )
    ),
    consentRecords:
      (await n(
        db
          .select({ n: count() })
          .from(consentEvent)
          .where(
            sql`(${eq(consentEvent.subjectType, "user")} AND ${within(consentEvent.subjectId, users)}) OR (${eq(consentEvent.subjectType, "participant_profile")} AND ${within(consentEvent.subjectId, profileIds)})`
          )
      )) + evidencedProfiles.size,
    auditEntries: await n(
      db
        .select({ n: count() })
        .from(auditLog)
        .where(within(auditLog.actorUserId, users))
    ),
    privacyRequests: await n(
      db
        .select({ n: count() })
        .from(privacyRequest)
        .where(
          sql`(${eq(privacyRequest.subjectKind, "user")} AND ${within(privacyRequest.subjectId, users)}) OR (${eq(privacyRequest.subjectKind, "participant_profile")} AND ${within(privacyRequest.subjectId, profileIds)})`
        )
    ),
  };

  return {
    scope: live,
    facts,
    donations,
    users,
    consents,
    entryIds,
    fileIds,
    objects: await objectsOf(db, fileIds),
    registrations: { free: freeRegistrations, kept: keptRegistrations },
    profiles: { delete: deletableProfiles, anonymise: keptProfiles },
  };
}

/** The anonymised columns of a profile that must stay. */
function anonymisedProfile(cipher: FieldCipher, profileId: string) {
  return {
    fullName: TOMBSTONE,
    dobCiphertext: cipher.encrypt(PROFILE_PURPOSE.dob, ERASED_DATE_OF_BIRTH),
    identityHash: `erased:${profileId}`,
    ownerUserId: null,
    loginUserId: null,
    participantCode: null,
    grade: null,
    studentRef: null,
    phoneCiphertext: null,
    emailCiphertext: null,
    guardianNameCiphertext: null,
    guardianRelationship: null,
    guardianPhoneCiphertext: null,
    guardianEmailCiphertext: null,
    addressCiphertext: null,
    pinCode: null,
    city: null,
    state: null,
    country: null,
    schoolName: null,
    createdBy: null,
  } as const;
}

/** Deletes files' rows: derivatives and processing first (restrict). */
async function deleteFiles(tx: AppDb, fileIds: readonly string[]) {
  if (fileIds.length === 0) return;
  const ids = [...fileIds];
  await tx
    .delete(fileDerivative)
    .where(inArray(fileDerivative.fileAssetId, ids));
  await tx
    .delete(fileProcessing)
    .where(inArray(fileProcessing.fileAssetId, ids));
  await tx.delete(fileAsset).where(inArray(fileAsset.id, ids));
}

/**
 * Changes the records `targets` found, as `plan` decided. Runs in the
 * caller's transaction; the stored objects are the caller's to delete.
 */
async function eraseRecords(
  tx: AppDb,
  deps: { clock: OutboxDeps["clock"]; cipher: FieldCipher },
  targets: ErasureTargets,
  plan: ErasurePlan,
  approverUserId: string
): Promise<void> {
  const ctx = { db: tx, clock: deps.clock, actor: WORKER };
  for (const userId of targets.scope.userIds) await lockUserSubject(tx, userId);
  for (const profileId of targets.scope.profileIds) {
    await lockProfileSubject(tx, profileId);
  }
  for (const consent of targets.consents) {
    await appendConsentEvent(tx, ctx, consent.state, {
      subject: consent.subject,
      giverUserId: approverUserId,
      purpose: consent.purpose,
      action: "withdrawn",
      documentId:
        consent.state.status === "never" ? "" : consent.state.documentId,
      method: "staff_recorded",
      competitionId: consent.competitionId,
      actorRole: null,
    });
  }
  if (targets.donations.liveMandateIds.length > 0) {
    throw new Error("Recurring donation cancellation not confirmed");
  }
  await withdrawDonationRecognition(tx, targets.donations);
  await eraseOwnedListings(tx, deps, targets.users, targets.facts.onLegalHold);
  if (targets.facts.onLegalHold) return;

  const { scope, entryIds, fileIds, registrations, profiles, users } = targets;
  const registrationIds = [...registrations.free, ...registrations.kept];
  await tx
    .delete(entryUploadGrant)
    .where(within(entryUploadGrant.registrationId, registrationIds));
  // Judging (#95) references the entry with composite foreign keys.
  // Remove its assignments and conflict flags before the pool row and entry.
  await tx
    .delete(roundAssignment)
    .where(within(roundAssignment.entryId, entryIds));
  await tx.delete(judgeConflict).where(within(judgeConflict.entryId, entryIds));
  await tx.delete(roundEntry).where(within(roundEntry.entryId, entryIds));
  await tx.delete(entry).where(within(entry.id, entryIds));
  await deleteFiles(tx, fileIds);
  await tx
    .delete(registration)
    .where(within(registration.id, registrations.free));
  await tx
    .delete(guardianLink)
    .where(within(guardianLink.participantProfileId, scope.profileIds));
  await tx
    .delete(guardianInvitation)
    .where(within(guardianInvitation.participantProfileId, scope.profileIds));
  await tx
    .delete(participantProfile)
    .where(within(participantProfile.id, profiles.delete));
  for (const profileId of profiles.anonymise) {
    await tx
      .update(participantProfile)
      .set({
        ...anonymisedProfile(deps.cipher, profileId),
        updatedAt: deps.clock.now(),
      })
      .where(eq(participantProfile.id, profileId));
  }

  const keepAccount = plan.categories.some(
    (each) => each.key === "account" && each.action === "retain"
  );
  if (!keepAccount) {
    await tx.delete(user).where(within(user.id, users));
    return;
  }
  // The account stays with its name and contact only.
  await tx.delete(session).where(within(session.userId, users));
  await tx.delete(account).where(within(account.userId, users));
  await tx.delete(secondFactor).where(within(secondFactor.userId, users));
  await tx
    .delete(secondFactorLockout)
    .where(within(secondFactorLockout.userId, users));
  await tx.delete(userRole).where(within(userRole.userId, users));
  await tx
    .delete(notificationPreference)
    .where(within(notificationPreference.userId, users));
  await tx.delete(inboxItem).where(within(inboxItem.userId, users));
  await tx.delete(messageDelivery).where(within(messageDelivery.userId, users));
  await tx
    .delete(guardianInvitation)
    .where(within(guardianInvitation.requestedByUserId, users));
  await tx.delete(guardian).where(within(guardian.userId, users));
}

export type ErasurePreview = {
  plan: ErasurePlan;
  /** Whether erasure may be carried out now (privacy.erasureEnabled). */
  enabled: boolean;
};

export type PreviewErasureResult =
  | { ok: true; preview: ErasurePreview }
  | InvalidInput
  | { ok: false; error: "not_found" | "not_erasure" | "request_closed" };

const idInput = z.strictObject({ id: z.uuid() });

/** What erasure would do, for the officer to check. Writes nothing. */
export async function previewErasure(
  ctx: UseCaseContext,
  input: { id: string }
): Promise<PreviewErasureResult> {
  return withOfficer<PreviewErasureResult>(
    ctx,
    "privacy_request.preview_erasure",
    async (tx) => {
      const parsed = idInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const [row] = await tx
        .select()
        .from(privacyRequest)
        .where(eq(privacyRequest.id, parsed.data.id));
      if (!row) return { result: NOT_FOUND };
      if (row.type !== "erasure") {
        return { result: { ok: false, error: "not_erasure" } as const };
      }
      if (row.closedAt !== null) {
        return { result: { ok: false, error: "request_closed" } as const };
      }
      const targets = await gatherErasure(tx, row, ctx.clock.now());
      return {
        result: {
          ok: true,
          preview: {
            plan: planErasure(targets.facts),
            enabled: await readSetting(tx, "privacy.erasureEnabled"),
          },
        } as const,
      };
    }
  );
}

export type ExecuteErasureResult =
  | { ok: true }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | "not_erasure"
        | "not_started"
        | "request_closed"
        | "erasure_disabled"
        | "plan_changed"
        | "already_approved";
    };

const executeInput = z.strictObject({
  id: z.uuid(),
  fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
});

/**
 * Approves the plan the officer previewed, by its fingerprint, and hands
 * it to the worker. Needs a fresh second factor; refused while erasure is
 * switched off, or when the plan has changed since the preview.
 */
export async function executeErasure(
  ctx: UseCaseContext,
  input: { id: string; fingerprint: string }
): Promise<ExecuteErasureResult> {
  return withOfficer<ExecuteErasureResult>(
    ctx,
    "privacy_request.execute_erasure",
    async (tx, officer) => {
      const parsed = executeInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const row = await lockRequest(tx, parsed.data.id);
      if (!row) return { result: NOT_FOUND };
      if (row.type !== "erasure") {
        return { result: { ok: false, error: "not_erasure" } as const };
      }
      const decision = decideRequestTransition({
        from: row.status,
        event: "complete",
        type: row.type,
      });
      if (!decision.ok) {
        return {
          result: {
            ok: false,
            error:
              decision.reason === "not_started"
                ? "not_started"
                : "request_closed",
          } as const,
        };
      }
      if (row.erasureFingerprint !== null) {
        return { result: { ok: false, error: "already_approved" } as const };
      }
      if (!(await readSetting(tx, "privacy.erasureEnabled"))) {
        return { result: { ok: false, error: "erasure_disabled" } as const };
      }
      const plan = planErasure(
        (await gatherErasure(tx, row, ctx.clock.now())).facts
      );
      if (plan.fingerprint !== parsed.data.fingerprint) {
        return { result: { ok: false, error: "plan_changed" } as const };
      }
      const now = ctx.clock.now();
      const [updated] = await tx
        .update(privacyRequest)
        .set({
          erasureFingerprint: plan.fingerprint,
          erasureApprovedByUserId: officer.userId,
          erasureApprovedAt: now,
          erasureFailure: null,
          updatedAt: now,
        })
        .where(eq(privacyRequest.id, row.id))
        .returning();
      await emit(tx, ctx.clock, {
        type: "privacy_request.erasure_approved",
        aggregate: { type: "privacy_request", id: row.id },
        payload: { requestId: row.id },
      });
      return {
        result: { ok: true } as const,
        audit: {
          action: "privacy_request.erasure_approved",
          entity: { type: "privacy_request", id: row.id },
          before: privacyRequestAuditSnapshot(row),
          after: privacyRequestAuditSnapshot(updated!),
        },
      };
    }
  );
}

export type ErasureJobDeps = Pick<
  OutboxDeps,
  "db" | "clock" | "cipher" | "storage" | "settings" | "email" | "payments"
> & { errors?: ErrorReporter };

async function deleteObjects(
  storage: ObjectStorage,
  objects: readonly StoredObject[]
) {
  for (const object of objects) await storage.delete(object);
}

/** Clears an approval the worker can't carry out, saying why. */
async function refuseApproval(
  deps: ErasureJobDeps,
  requestId: string,
  failure: "plan_changed" | "erasure_disabled"
) {
  await deps.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    if (!row || row.erasureFingerprint === null) return;
    const [updated] = await tx
      .update(privacyRequest)
      .set({
        erasureFingerprint: null,
        erasureApprovedByUserId: null,
        erasureApprovedAt: null,
        erasureFailure: failure,
        updatedAt: deps.clock.now(),
      })
      .where(eq(privacyRequest.id, requestId))
      .returning();
    await recordAudit(
      tx,
      { clock: deps.clock, actor: WORKER },
      {
        action: "privacy_request.erasure_refused",
        entity: { type: "privacy_request", id: requestId },
        before: privacyRequestAuditSnapshot(row),
        after: privacyRequestAuditSnapshot(updated!),
        actorRole: null,
      }
    );
  });
}

/** The requester's address, while their account exists. */
async function requesterContact(db: AppDb, userId: string | null) {
  if (userId === null) return null;
  const [row] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  return row?.email ? { name: row.name, email: row.email } : null;
}

/**
 * Tells someone whose own account the erasure deleted that it is done.
 * Their account and inbox are gone, so no route row can; this sends once,
 * after the erasure committed. A failure is reported, not retried: the
 * erasure stands, and the officer tells them by hand.
 */
async function sendErasedNotice(
  deps: ErasureJobDeps,
  requestId: string,
  to: { name: string; email: string }
) {
  try {
    const [template] = await deps.db
      .select()
      .from(messageTemplate)
      .where(
        and(
          eq(messageTemplate.key, "privacy_request.erased"),
          eq(messageTemplate.channel, "email")
        )
      );
    if (!template?.subject) throw new Error("No erasure notice template");
    const values = {
      "recipient.name": to.name,
      ...(await requestValues(deps.db, requestId)),
    };
    const text = renderTemplate(template.body, values);
    await (deps.email as EmailSender).send({
      to: to.email,
      subject: renderTemplate(template.subject, values),
      text,
      html: renderEmailHtml(text),
    });
  } catch (error) {
    deps.errors?.report(error, {
      where: "privacy.execute_erasure",
      tags: { job: "privacy.execute_erasure" },
    });
  }
}

/**
 * The worker's job. Plans again and refuses if the plan isn't the one the
 * officer approved, or if erasure was switched off meanwhile. Safe to
 * repeat: a closed request, or one with no approval, is left alone.
 */
export async function runExecuteErasure(
  deps: ErasureJobDeps,
  payload: { requestId: string }
): Promise<void> {
  const ctx = { db: deps.db, clock: deps.clock, actor: WORKER };
  await authorize(ctx, "privacy_request.run_jobs");
  const [row] = await deps.db
    .select()
    .from(privacyRequest)
    .where(eq(privacyRequest.id, payload.requestId));
  if (!row || row.status !== "in_progress" || row.erasureFingerprint === null) {
    return;
  }
  if (!(await deps.settings.get("privacy.erasureEnabled"))) {
    await refuseApproval(deps, row.id, "erasure_disabled");
    return;
  }
  if (row.erasureApprovedByUserId === null) {
    // The approving officer's account is gone: someone approves again.
    await refuseApproval(deps, row.id, "plan_changed");
    return;
  }
  const approver = row.erasureApprovedByUserId;
  // Commit cancellation cutoffs before contacting the provider, and withdraw
  // optional publicity immediately. A provider outage must leave the account
  // and the approved request intact; both deliveries can then safely retry.
  const preflight = await deps.db.transaction(async (tx) => {
    const locked = await lockRequest(tx, row.id);
    if (
      !locked ||
      locked.status !== "in_progress" ||
      locked.erasureFingerprint !== row.erasureFingerprint ||
      locked.erasureApprovedByUserId !== approver
    )
      return null;
    const scope = await subjectScope(tx, locked);
    for (const id of [...scope.userIds, ...scope.profileIds])
      await lockSubject(tx, id);
    const targets = await gatherErasure(tx, locked, deps.clock.now());
    if (planErasure(targets.facts).fingerprint !== locked.erasureFingerprint) {
      return "changed" as const;
    }
    const cancelling = await prepareDonationErasure(
      tx,
      { ...deps, actor: WORKER },
      targets.donations
    );
    return { targets, cancelling };
  });
  if (preflight === null) return;
  if (preflight === "changed") {
    await refuseApproval(deps, row.id, "plan_changed");
    return;
  }
  await confirmDonationErasure(
    { ...deps, actor: WORKER },
    preflight.cancelling
  );
  // A reconciled pre-cutoff charge may change the reason an account must
  // stay. Recheck before deleting files or account data.
  const first =
    preflight.cancelling.length === 0
      ? preflight.targets
      : await gatherErasure(deps.db, row, deps.clock.now());
  const firstPlan = planErasure(first.facts);
  if (firstPlan.fingerprint !== row.erasureFingerprint) {
    await refuseApproval(deps, row.id, "plan_changed");
    return;
  }
  if (first.donations.liveMandateIds.length > 0) {
    throw new Error("Recurring donation cancellation not confirmed");
  }
  const accountGoes = !firstPlan.categories.some(
    (each) => each.key === "account" && each.action === "retain"
  );
  const notify =
    accountGoes &&
    row.requestedByUserId !== null &&
    first.users.includes(row.requestedByUserId)
      ? await requesterContact(deps.db, row.requestedByUserId)
      : null;
  if (!first.facts.onLegalHold)
    await deleteObjects(deps.storage, first.objects);

  const outcome = await deps.db.transaction(async (tx) => {
    const locked = await lockRequest(tx, row.id);
    if (
      !locked ||
      locked.status !== "in_progress" ||
      locked.erasureFingerprint !== row.erasureFingerprint
    ) {
      return null;
    }
    for (const id of [...first.scope.userIds, ...first.scope.profileIds]) {
      await lockSubject(tx, id);
    }
    const targets = await gatherErasure(tx, locked, deps.clock.now());
    const plan = planErasure(targets.facts);
    if (plan.fingerprint !== locked.erasureFingerprint)
      return "changed" as const;

    await eraseRecords(tx, deps, targets, plan, approver);
    const now = deps.clock.now();
    await tx.insert(erasureRecord).values({
      id: uuidv7(now),
      requestId: locked.id,
      subjectKind: locked.subjectKind,
      subjectId: locked.subjectId,
      userIds: [...targets.scope.userIds],
      profileIds: [...targets.scope.profileIds],
      outcome: plan.outcome,
      categories: plan.categories.map((each) => ({
        key: each.key,
        action: each.action,
        basis: each.basis,
        until: each.until?.toISOString() ?? null,
        count: each.count,
      })),
      retainedUntil: retainedUntil(plan),
      erasedAt: now,
    });
    const status =
      plan.outcome === "completed" ? "completed" : "partially_completed";
    const [updated] = await tx
      .update(privacyRequest)
      .set({
        status,
        retained: retainedCategories(plan),
        closedAt: now,
        updatedAt: now,
      })
      .where(eq(privacyRequest.id, locked.id))
      .returning();
    await recordAudit(tx, ctx, {
      action: "privacy_request.erased",
      entity: { type: "privacy_request", id: locked.id },
      before: privacyRequestAuditSnapshot(locked),
      after: privacyRequestAuditSnapshot(updated!),
      actorRole: null,
    });
    await emit(tx, deps.clock, {
      type: "privacy_request.completed",
      aggregate: { type: "privacy_request", id: locked.id },
      payload: { requestId: locked.id },
    });
    return { targets };
  });
  if (outcome === "changed") {
    await refuseApproval(deps, row.id, "plan_changed");
    return;
  }
  if (outcome === null) return;
  // Files that appeared between the two passes.
  if (!outcome.targets.facts.onLegalHold) {
    await deleteObjects(deps.storage, outcome.targets.objects);
  }
  if (notify) await sendErasedNotice(deps, row.id, notify);
}
