import { createHash } from "node:crypto";
import {
  and,
  arrayOverlaps,
  asc,
  desc,
  eq,
  gt,
  inArray,
  ne,
} from "drizzle-orm";
import { z } from "zod";
import type { Role } from "../../access/domain/roles";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  certificate,
  certificateArchive,
  competition,
  fileAsset,
  institution,
  institutionRegistration,
  registration,
  participantProfile,
  user,
  type CertificateArchiveRow,
} from "../../db/schema";
import { DomainError } from "../../errors";
import { uuidv7 } from "../../ids";
import { emit } from "../../outbox/emit";
import type { OutboxDeps } from "../../outbox/handlers";
import type { UseCaseContext } from "../../use-cases";
import { institutionResource } from "../institutions/coordinators/policy";
import { activeLegalHolds, lockRetentionHolds } from "../privacy/holds";
import { lockSubject } from "../privacy/requests/submit";
import { zipStore } from "../privacy/requests/subject-data/zip";
import { lockLiveSession } from "../second-factor/session-factor";

const DAY = 86400000;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const worker = { kind: "system", process: "worker" } as const;
type ArchiveRef = { institutionId: string; reference: string };
type JobInput = { archiveId: string };
type JobsContext = Pick<OutboxDeps, "db" | "clock" | "storage"> & {
  actor: UseCaseContext["actor"];
};
const archiveDenied = () =>
  new DomainError("forbidden", "Certificate archive access denied");

async function byRef(db: AppDb, ref: ArchiveRef) {
  if (!z.uuid().safeParse(ref.institutionId).success) return undefined;
  const [row] = await db
    .select()
    .from(institutionRegistration)
    .where(
      and(
        eq(institutionRegistration.institutionId, ref.institutionId),
        eq(institutionRegistration.reference, ref.reference)
      )
    );
  return row;
}
async function byId(db: AppDb, id: string) {
  if (!z.uuid().safeParse(id).success) return undefined;
  const [row] = await db
    .select()
    .from(certificateArchive)
    .where(eq(certificateArchive.id, id));
  return row;
}
async function registrationOf(db: AppDb, id: string) {
  const [row] = await db
    .select()
    .from(institutionRegistration)
    .where(eq(institutionRegistration.id, id));
  return row;
}
type School = NonNullable<Awaited<ReturnType<typeof registrationOf>>>;

async function lockCompetition(db: AppDb, competitionId: string) {
  await db
    .select({ id: competition.id })
    .from(competition)
    .where(eq(competition.id, competitionId))
    .for("update");
}
async function verified(db: AppDb, school: School) {
  const [row] = await db
    .select({ status: institution.status })
    .from(institution)
    .where(eq(institution.id, school.institutionId))
    .for("share");
  const [current] = await db
    .select({ status: institutionRegistration.status })
    .from(institutionRegistration)
    .where(eq(institutionRegistration.id, school.id))
    .for("share");
  return row?.status === "verified" && current?.status === "active";
}
async function scopedSchool(ctx: UseCaseContext, school: School | undefined) {
  if (!school || ctx.actor.kind !== "user") throw archiveDenied();
  // Roles are read fresh. A grant revocation or sign-out serializes with the
  // authorization that signs this link, not the earlier request for the ZIP.
  await ctx.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, ctx.actor.userId))
    .for("share");
  await lockLiveSession(ctx.db, ctx.actor, ctx.clock);
  const decision = await authorize(
    ctx,
    "certificates.institution_archive",
    institutionResource(school.institutionId)
  );
  if (!(await verified(ctx.db, school))) throw archiveDenied();
  return decision.role;
}

/** All current certificates, not only the PDFs which happen to be ready. */
async function currentPdfs(db: AppDb, school: School) {
  return db
    .select({
      id: certificate.id,
      profileId: registration.participantProfileId,
      number: certificate.number,
      renderStatus: certificate.renderStatus,
      fileId: fileAsset.id,
      key: fileAsset.storageKey,
      bucket: fileAsset.bucket,
      size: fileAsset.sizeBytes,
      sha256: fileAsset.sha256,
    })
    .from(certificate)
    .innerJoin(
      registration,
      and(
        eq(registration.id, certificate.registrationId),
        eq(registration.participantProfileId, certificate.participantProfileId),
        eq(registration.competitionId, certificate.competitionId)
      )
    )
    .leftJoin(
      fileAsset,
      and(
        eq(certificate.pdfFileId, fileAsset.id),
        eq(fileAsset.purpose, "certificate_pdf"),
        eq(fileAsset.status, "clean")
      )
    )
    .where(
      and(
        eq(registration.institutionRegistrationId, school.id),
        eq(registration.competitionId, school.competitionId),
        eq(registration.route, "institution"),
        eq(registration.status, "confirmed"),
        eq(certificate.status, "issued")
      )
    )
    .orderBy(asc(certificate.id));
}
type Pdfs = Awaited<ReturnType<typeof currentPdfs>>;
function allReady(rows: Pdfs) {
  return (
    rows.length > 0 &&
    rows.every((r) => r.renderStatus === "rendered" && r.fileId !== null)
  );
}
function matches(archive: CertificateArchiveRow, rows: Pdfs) {
  return (
    allReady(rows) &&
    archive.certificateIds.length === rows.length &&
    rows.every((row, index) => row.id === archive.certificateIds[index])
  );
}
async function matchingArchive(
  ctx: Pick<UseCaseContext, "db" | "clock">,
  school: School,
  rows: Pdfs
) {
  const candidates = await ctx.db
    .select()
    .from(certificateArchive)
    .where(
      and(
        eq(certificateArchive.institutionRegistrationId, school.id),
        gt(certificateArchive.expiresAt, ctx.clock.now()),
        inArray(certificateArchive.status, ["pending", "ready", "failed"])
      )
    )
    .orderBy(desc(certificateArchive.createdAt));
  const matching = candidates.filter((a) => matches(a, rows));
  return matching.find((a) => a.status !== "failed") ?? matching[0];
}

export async function getInstitutionCertificateArchive(
  ctx: UseCaseContext,
  ref: ArchiveRef
) {
  await authorize(
    ctx,
    "certificates.institution_archive",
    institutionResource(ref.institutionId)
  );
  return ctx.db.transaction(async (tx) => {
    const school = await byRef(tx, ref);
    await scopedSchool({ ...ctx, db: tx }, school);
    const rows = await currentPdfs(tx, school!);
    const archive = await matchingArchive({ ...ctx, db: tx }, school!, rows);
    return {
      ok: true,
      count: rows.length,
      readyCount: rows.filter(
        (row) => row.renderStatus === "rendered" && row.fileId
      ).length,
      archive: archive
        ? {
            id: archive.id,
            status: archive.status,
            expiresAt: archive.expiresAt,
          }
        : null,
    } as const;
  });
}

export async function requestInstitutionCertificateArchive(
  ctx: UseCaseContext,
  ref: ArchiveRef
) {
  await authorize(
    ctx,
    "certificates.institution_archive",
    institutionResource(ref.institutionId)
  );
  return ctx.db.transaction(async (tx) => {
    const school = await byRef(tx, ref);
    if (!school) throw archiveDenied();
    await lockCompetition(tx, school.competitionId);
    const role = await scopedSchool({ ...ctx, db: tx }, school);
    const rows = await currentPdfs(tx, school);
    if (rows.length === 0) return { ok: false, error: "empty" } as const;
    if (!allReady(rows)) return { ok: false, error: "not_ready" } as const;
    if (rows.reduce((n, row) => n + (row.size ?? 0), 0) > MAX_ARCHIVE_BYTES)
      return { ok: false, error: "too_large" } as const;
    const existing = await matchingArchive({ ...ctx, db: tx }, school, rows);
    if (existing && existing.status !== "failed")
      return {
        ok: true,
        archiveId: existing.id,
        status: existing.status,
      } as const;
    if (ctx.files.keyPrefix === null)
      return { ok: false, error: "not_ready" } as const;
    const now = ctx.clock.now(),
      id = uuidv7(now);
    await tx.insert(certificateArchive).values({
      id,
      institutionRegistrationId: school.id,
      certificateIds: rows.map((r) => r.id),
      profileIds: [...new Set(rows.map((r) => r.profileId))].sort(),
      bucket: ctx.files.bucket,
      storageKey: `${ctx.files.keyPrefix}certificate_archive/${id}.zip`,
      createdAt: now,
      expiresAt: new Date(now.getTime() + DAY),
    });
    await emit(tx, ctx.clock, {
      type: "certificate.archive_requested",
      aggregate: { type: "certificate_archive", id },
      payload: { archiveId: id },
    });
    await queueExpiry({ ...ctx, db: tx }, id, new Date(now.getTime() + DAY));
    await recordAudit(tx, ctx, {
      action: "certificate.archive_requested",
      entity: { type: "certificate_archive", id },
      before: null,
      after: { institutionRegistrationId: school.id, count: rows.length },
      actorRole: role,
    });
    return { ok: true, archiveId: id, status: "pending" } as const;
  });
}

async function queueExpiry(
  ctx: Pick<JobsContext, "db" | "clock">,
  id: string,
  availableAt: Date
) {
  await emit(
    ctx.db,
    ctx.clock,
    {
      type: "certificate.archive_expired",
      aggregate: { type: "certificate_archive", id },
      payload: { archiveId: id },
    },
    { availableAt }
  );
}

async function lockedArchive(db: AppDb, id: string) {
  const [row] = await db
    .select()
    .from(certificateArchive)
    .where(eq(certificateArchive.id, id))
    .for("update");
  return row;
}

async function storedPdf(storage: JobsContext["storage"], pdf: Pdfs[number]) {
  if (!pdf.size || pdf.size > MAX_ARCHIVE_BYTES || !pdf.sha256)
    throw new Error("Certificate PDF unavailable");
  const reader = (
    await storage.read({ bucket: pdf.bucket!, key: pdf.key! })
  ).getReader();
  const bytes = new Uint8Array(pdf.size);
  let offset = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (offset + next.value.byteLength > bytes.length) {
        await reader.cancel();
        throw new Error("Certificate PDF unavailable");
      }
      bytes.set(next.value, offset);
      offset += next.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (
    offset !== bytes.length ||
    createHash("sha256").update(bytes).digest("hex") !== pdf.sha256
  )
    throw new Error("Certificate PDF unavailable");
  return bytes;
}

async function setArchiveStatus(
  ctx: JobsContext,
  row: CertificateArchiveRow,
  status: "invalidated" | "failed",
  role: Role | null = null
) {
  await ctx.db
    .update(certificateArchive)
    .set({ status })
    .where(eq(certificateArchive.id, row.id));
  await recordAudit(ctx.db, ctx, {
    action:
      status === "failed"
        ? "certificate.archive_failed"
        : "certificate.archive_invalidated",
    entity: { type: "certificate_archive", id: row.id },
    before: { status: row.status },
    after: { status },
    actorRole: role,
  });
}

export async function buildInstitutionCertificateArchive(
  ctx: JobsContext,
  { archiveId }: JobInput
) {
  await authorize(ctx, "certificates.archive_jobs");
  const hint = await byId(ctx.db, archiveId);
  if (!hint) return;
  await ctx.db.transaction(async (tx) => {
    // The subject lock is shared with erasure. A later erasure sees the
    // committed ZIP, and an earlier erasure prevents stale bytes being built.
    for (const profileId of hint.profileIds) await lockSubject(tx, profileId);
    const school = await registrationOf(tx, hint.institutionRegistrationId);
    if (!school) return;
    await lockCompetition(tx, school.competitionId);
    const row = await lockedArchive(tx, archiveId);
    if (!row || row.status !== "pending" || row.expiresAt <= ctx.clock.now())
      return;
    const rows = await currentPdfs(tx, school);
    if (!(await verified(tx, school)) || !matches(row, rows)) {
      await setArchiveStatus({ ...ctx, db: tx }, row, "invalidated");
      await queueExpiry({ ...ctx, db: tx }, row.id, ctx.clock.now());
      return;
    }
    try {
      const parts = [];
      let total = 0;
      for (const pdf of rows) {
        const bytes = await storedPdf(ctx.storage, pdf);
        total += bytes.byteLength;
        if (
          total > MAX_ARCHIVE_BYTES ||
          bytes.byteLength !== pdf.size ||
          new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
        )
          throw new Error("Certificate PDF unavailable");
        parts.push({ name: `${pdf.number}.pdf`, bytes });
      }
      const body = zipStore(parts, { modifiedAt: ctx.clock.now() });
      await ctx.storage.write({
        bucket: row.bucket,
        key: row.storageKey,
        body,
        contentType: "application/zip",
      });
    } catch {
      await setArchiveStatus({ ...ctx, db: tx }, row, "failed");
      return;
    }
    await tx
      .update(certificateArchive)
      .set({ status: "ready" })
      .where(eq(certificateArchive.id, row.id));
    await recordAudit(tx, ctx, {
      action: "certificate.archive_built",
      entity: { type: "certificate_archive", id: row.id },
      before: { status: "pending" },
      after: { status: "ready", count: rows.length },
      actorRole: null,
    });
  });
}

export async function getInstitutionCertificateArchiveLink(
  ctx: UseCaseContext,
  { archiveId }: JobInput
) {
  return ctx.db.transaction(async (tx) => {
    const hint = await byId(tx, archiveId);
    const school = hint
      ? await registrationOf(tx, hint.institutionRegistrationId)
      : undefined;
    if (!school) throw archiveDenied();
    await authorize(
      { ...ctx, db: tx },
      "certificates.institution_archive",
      institutionResource(school.institutionId)
    );
    await lockCompetition(tx, school.competitionId);
    const role = await scopedSchool({ ...ctx, db: tx }, school);
    const row = await lockedArchive(tx, archiveId);
    const now = ctx.clock.now();
    if (
      !row ||
      row.status !== "ready" ||
      row.expiresAt <= now ||
      !matches(row, await currentPdfs(tx, school))
    )
      return { ok: false, error: "not_ready" } as const;
    const remaining = Math.min(
      300,
      Math.floor((row.expiresAt.getTime() - now.getTime()) / 1000)
    );
    if (remaining < 1) return { ok: false, error: "not_ready" } as const;
    const { url } = await ctx.storage.presignGet({
      bucket: row.bucket,
      key: row.storageKey,
      expiresInSeconds: remaining,
      contentType: "application/zip",
      disposition: "attachment",
      filename: `${school.reference}-certificates.zip`,
    });
    await recordAudit(tx, ctx, {
      action: "certificate.archive_downloaded",
      entity: { type: "certificate_archive", id: row.id },
      before: null,
      after: null,
      actorRole: role,
    });
    return {
      ok: true,
      url,
      expiresAt: new Date(now.getTime() + remaining * 1000),
    } as const;
  });
}

async function held(db: AppDb, row: CertificateArchiveRow) {
  const school = await registrationOf(db, row.institutionRegistrationId);
  const profiles = await db
    .select({
      owner: participantProfile.ownerUserId,
      login: participantProfile.loginUserId,
    })
    .from(participantProfile)
    .where(inArray(participantProfile.id, row.profileIds));
  const users = new Set(profiles.flatMap((p) => [p.owner, p.login]));
  return (await activeLegalHolds(db)).some(
    (hold) =>
      (hold.subjectType === "institution" &&
        hold.subjectId === school?.institutionId) ||
      (hold.subjectType === "participant_profile" &&
        row.profileIds.includes(hold.subjectId)) ||
      (hold.subjectType === "user" && users.has(hold.subjectId))
  );
}

/** Stops delivery before purging. Held evidence cannot be downloaded. */
async function purge(ctx: JobsContext, row: CertificateArchiveRow) {
  if (await held(ctx.db, row)) {
    if (row.status !== "invalidated")
      await setArchiveStatus(ctx, row, "invalidated");
    await queueExpiry(ctx, row.id, new Date(ctx.clock.now().getTime() + DAY));
    return;
  }
  await ctx.storage.delete({ bucket: row.bucket, key: row.storageKey });
  await ctx.db
    .delete(certificateArchive)
    .where(eq(certificateArchive.id, row.id));
  await recordAudit(ctx.db, ctx, {
    action: "certificate.archive_deleted",
    entity: { type: "certificate_archive", id: row.id },
    before: null,
    after: null,
    actorRole: null,
  });
}

export async function expireInstitutionCertificateArchive(
  ctx: JobsContext,
  { archiveId }: JobInput
) {
  await authorize(ctx, "certificates.archive_jobs");
  await ctx.db.transaction(async (tx) => {
    await lockRetentionHolds(tx);
    const row = await lockedArchive(tx, archiveId);
    if (
      !row ||
      (row.expiresAt > ctx.clock.now() && row.status !== "invalidated")
    )
      return;
    await purge({ ...ctx, db: tx }, row);
  });
}

/** Invalidate archives in the correction transaction. Any previously
 * handed out storage link can live at most five minutes; the worker
 * purges the underlying ZIP promptly unless evidence must be kept. */
export async function invalidateCertificateArchives(
  ctx: JobsContext,
  certificateId: string,
  role: Role | null
) {
  const rows = await ctx.db
    .select()
    .from(certificateArchive)
    .where(
      and(
        arrayOverlaps(certificateArchive.certificateIds, [certificateId]),
        ne(certificateArchive.status, "invalidated")
      )
    )
    .orderBy(asc(certificateArchive.id))
    .for("update");
  for (const row of rows) {
    await setArchiveStatus(ctx, row, "invalidated", role);
    await queueExpiry(ctx, row.id, ctx.clock.now());
  }
}

/** Erasure must remove the whole mixed-subject ZIP, not export its contents
 * to another subject or rely on the certificate FK being deleted. */
export async function purgeArchivesForErasure(
  ctx: Omit<JobsContext, "actor">,
  profileIds: readonly string[]
) {
  if (!profileIds.length) return;
  await lockRetentionHolds(ctx.db);
  const rows = await ctx.db
    .select()
    .from(certificateArchive)
    .where(arrayOverlaps(certificateArchive.profileIds, [...profileIds]))
    .orderBy(asc(certificateArchive.id))
    .for("update");
  for (const row of rows) await purge({ ...ctx, actor: worker }, row);
}
