import { and, asc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { authorize, can } from "../../access/can";
import { recordAudit } from "../../audit/record";
import {
  certificate,
  competition,
  fileAsset,
  guardian,
  guardianLink,
  participantProfile,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { verifiedLink } from "../guardians/child-access";
import { publicUse } from "../consent";
import {
  firstNameAndInitial,
  nameParts,
} from "../consent/domain/public-credit";
import { takeFormAllowance } from "../public-forms/rate-limit";
import { normaliseCertificateNumber } from "./domain/number";
import { indianDateAt } from "../registration/domain/calendar-date";
import { queueCertificateRender } from "./issue";
import type { CertificateRenderStatus } from "./domain/status";
import { DomainError } from "../../errors";
const scope = (id: string) => ({
  scopes: [{ type: "competition" as const, id }],
});
const invalid = () => new DomainError("forbidden", "Certificate access denied");
const publicFields = {
  id: certificate.id,
  number: certificate.number,
  type: certificate.type,
  status: certificate.status,
  renderStatus: certificate.renderStatus,
  awardPosition: certificate.awardPosition,
  awardLabel: certificate.awardLabel,
  issuedAt: certificate.issuedAt,
};
export async function listCertificateCompetitions(ctx: UseCaseContext) {
  const comps = await ctx.db
    .select({
      id: competition.id,
      name: competition.name,
      code: competition.code,
    })
    .from(competition)
    .orderBy(asc(competition.name));
  const visible = [];
  for (const comp of comps)
    if ((await can(ctx, "certificates.list", scope(comp.id))).allowed)
      visible.push(comp);
  if (!visible.length) await authorize(ctx, "certificates.list");
  return visible;
}
export async function listCertificates(
  ctx: UseCaseContext,
  {
    competitionId,
    renderStatus,
  }: { competitionId: string; renderStatus?: CertificateRenderStatus }
) {
  await authorize(ctx, "certificates.list", scope(competitionId));
  if (!z.uuid().safeParse(competitionId).success) return [];
  const correction = await can(
    ctx,
    "certificates.correct",
    scope(competitionId)
  );
  const canCorrect = correction.allowed || "secondFactor" in correction;
  const rows = await ctx.db
    .select({
      ...publicFields,
      recipientName: certificate.nameSnapshot,
      revokedReason: certificate.revokedReason,
    })
    .from(certificate)
    .where(
      and(
        eq(certificate.competitionId, competitionId),
        renderStatus ? eq(certificate.renderStatus, renderStatus) : undefined
      )
    )
    .orderBy(asc(certificate.number));
  return rows.map(({ recipientName, revokedReason, ...row }) => ({
    ...row,
    correction:
      canCorrect && row.status === "issued" ? { recipientName } : null,
    revokedReason: canCorrect ? revokedReason : null,
  }));
}
export async function retryCertificateRender(
  ctx: UseCaseContext,
  { certificateId }: { certificateId: string }
) {
  if (!z.uuid().safeParse(certificateId).success) throw invalid();
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(certificate)
      .where(eq(certificate.id, certificateId))
      .for("update");
    if (!row) throw invalid();
    const { role } = await authorize(
      { ...ctx, db: tx },
      "certificates.retry_render",
      row.competitionId ? scope(row.competitionId) : {}
    );
    if (row.status !== "issued" || row.renderStatus !== "failed")
      return { ok: false, error: "not_retryable" } as const;
    await tx
      .update(certificate)
      .set({ renderStatus: "pending", renderAttempts: 0 })
      .where(eq(certificate.id, row.id));
    await queueCertificateRender(tx, ctx.clock, row.id);
    await recordAudit(tx, ctx, {
      action: "certificate.render_retried",
      entity: { type: "certificate", id: row.id },
      before: { renderStatus: "failed" },
      after: { renderStatus: "pending" },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}
/** Own adult/teen profile or a verified, still-active linked guardian. */
async function ownedProfiles(ctx: Pick<UseCaseContext, "db" | "actor">) {
  if (ctx.actor.kind !== "user") return [];
  const uid = ctx.actor.userId;
  const own = await ctx.db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(
      or(
        and(
          eq(participantProfile.ownerKind, "self"),
          eq(participantProfile.ownerUserId, uid)
        ),
        eq(participantProfile.loginUserId, uid)
      )
    );
  const linked = await ctx.db
    .select({ id: guardianLink.participantProfileId })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(and(eq(guardian.userId, uid), verifiedLink()));
  return [...new Set([...own, ...linked].map((r) => r.id))];
}
export async function listMyCertificates(ctx: UseCaseContext) {
  await authorize(ctx, "certificates.list_mine");
  const ids = await ownedProfiles(ctx);
  if (!ids.length) return [];
  return ctx.db
    .select({
      ...publicFields,
      participantProfileId: certificate.participantProfileId,
      recipientName: certificate.nameSnapshot,
      competitionName: competition.name,
      pdfFileId: certificate.pdfFileId,
    })
    .from(certificate)
    .leftJoin(competition, eq(competition.id, certificate.competitionId))
    .where(inArray(certificate.participantProfileId, ids))
    .orderBy(asc(certificate.nameSnapshot), asc(certificate.number))
    .then((rows) =>
      rows.map(({ pdfFileId, ...row }) => ({
        ...row,
        downloadable:
          row.status === "issued" &&
          row.renderStatus === "rendered" &&
          pdfFileId !== null,
      }))
    );
}
export async function getCertificateDownloadUrl(
  ctx: UseCaseContext,
  { certificateId }: { certificateId: string }
) {
  // Missing IDs and a wrong owner are indistinguishable, including staff.
  const ids = await ownedProfiles(ctx);
  if (!ids.length || !z.uuid().safeParse(certificateId).success)
    throw invalid();
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(certificate)
      .where(
        and(
          eq(certificate.id, certificateId),
          inArray(certificate.participantProfileId, ids)
        )
      )
      .for("update");
    const current = await ownedProfiles({ ...ctx, db: tx });
    const ownerId =
      ctx.actor.kind === "user" &&
      row &&
      current.includes(row.participantProfileId)
        ? ctx.actor.userId
        : undefined;
    await authorize({ ...ctx, db: tx }, "certificate.download", { ownerId });
    if (
      !row ||
      row.status !== "issued" ||
      row.renderStatus !== "rendered" ||
      !row.pdfFileId
    )
      return { ok: false, error: "not_ready" } as const;
    const [file] = await tx
      .select()
      .from(fileAsset)
      .where(
        and(
          eq(fileAsset.id, row.pdfFileId),
          eq(fileAsset.purpose, "certificate_pdf"),
          eq(fileAsset.status, "clean")
        )
      );
    if (!file) return { ok: false, error: "not_ready" } as const;
    const { url } = await ctx.storage.presignGet({
      bucket: file.bucket,
      key: file.storageKey,
      expiresInSeconds: 300,
      contentType: "application/pdf",
      disposition: "attachment",
      filename: `${row.number}.pdf`,
    });
    await recordAudit(tx, ctx, {
      action: "certificate.downloaded",
      entity: { type: "certificate", id: row.id },
      before: null,
      after: null,
      actorRole: null,
    });
    return {
      ok: true,
      url,
      expiresAt: new Date(ctx.clock.now().getTime() + 300000),
    } as const;
  });
}
export async function verifyCertificate(
  ctx: UseCaseContext,
  { number: input }: { number: string }
) {
  await authorize(ctx, "certificates.verify");
  const allowance = await takeFormAllowance(ctx.db, {
    form: "certificate_verify",
    rules: [
      {
        scope: "ip",
        key: ctx.actor.kind === "system" ? "system" : ctx.actor.meta.ip,
        max: 30,
        windowMs: 60_000,
      },
    ],
    now: ctx.clock.now(),
    hash: ctx.blindIndex,
  });
  if (!allowance.ok)
    return {
      outcome: "rate_limited",
      retryAfterSeconds: allowance.retryAfterSeconds,
    } as const;
  const number = normaliseCertificateNumber(input);
  if (!number) return { outcome: "unknown" } as const;
  const [row] = await ctx.db
    .select({
      cert: certificate,
      competition: { code: competition.code, name: competition.name },
    })
    .from(certificate)
    .leftJoin(competition, eq(competition.id, certificate.competitionId))
    .where(eq(certificate.number, number));
  if (!row) return { outcome: "unknown" } as const;
  if (row.cert.status !== "issued")
    return { outcome: "revoked", number } as const;
  const credit = row.cert.competitionId
    ? await publicUse(ctx, {
        profileId: row.cert.participantProfileId,
        competitionId: row.cert.competitionId,
        use: "results",
      })
    : null;
  const snapshot = row.cert.nameSnapshot
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ");
  const { firstName, lastName } = nameParts(snapshot);
  const allowedCredit =
    credit &&
    (credit.name === snapshot ||
      credit.name === firstNameAndInitial(firstName, lastName))
      ? { name: credit.name }
      : null;
  return {
    outcome: "valid",
    number,
    type: row.cert.type,
    awardPosition: row.cert.awardPosition,
    awardLabel: row.cert.awardLabel,
    competition: row.competition,
    issuedOn: indianDateAt(row.cert.issuedAt),
    credit: allowedCredit,
  } as const;
}
