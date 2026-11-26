// A correction can change the printed recipient name, not the award earned
// in the approved release. The old number is terminal, even when a render
// or issuance delivery is replayed.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { certificate, competition, user } from "../../db/schema";
import { DomainError } from "../../errors";
import { invalidInput } from "../../input";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import { lockSubject } from "../privacy/requests/submit";
import { lockLiveSession } from "../second-factor/session-factor";
import { assertCertificateTransition } from "./domain/status";
import { invalidateCertificateArchives } from "./archive";
import { insertCertificate } from "./issue";

// Fold whitespace for the printed name; reject unprintable controls in
// both fields (including NUL, which Postgres cannot store).
function printable(value: string) {
  for (const c of value) {
    const code = c.codePointAt(0)!;
    if (
      code !== 9 &&
      code !== 10 &&
      code !== 13 &&
      (code < 32 || (code >= 127 && code <= 159))
    )
      return false;
  }
  return true;
}
const common = z.object({
  certificateId: z.uuid(),
  reason: z.string().trim().min(1).max(1000).refine(printable),
});
const reissueInput = common.extend({
  recipientName: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .refine(printable)
    .transform((name) => name.normalize("NFC").replace(/\s+/gu, " ")),
});
type RevokeInput = z.input<typeof common>;
type ReissueInput = z.input<typeof reissueInput>;

export async function revokeCertificate(
  ctx: UseCaseContext,
  input: RevokeInput
) {
  const parsed = common.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return correct(ctx, parsed.data);
}
export async function reissueCertificate(
  ctx: UseCaseContext,
  input: ReissueInput
) {
  const parsed = reissueInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return correct(ctx, parsed.data);
}

async function correct(
  ctx: UseCaseContext,
  input: RevokeInput & { recipientName?: string }
) {
  return ctx.db.transaction(async (tx) => {
    const denied = () =>
      new DomainError("forbidden", "Certificate access denied");
    const [hint] = await tx
      .select({
        competitionId: certificate.competitionId,
        participantProfileId: certificate.participantProfileId,
        recipientUserId: certificate.recipientUserId,
        type: certificate.type,
      })
      .from(certificate)
      .where(eq(certificate.id, input.certificateId));
    if (!hint || ctx.actor.kind !== "user") throw denied();
    if (hint.recipientUserId) await lockSubject(tx, hint.recipientUserId);
    if (hint.participantProfileId)
      await lockSubject(tx, hint.participantProfileId);
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, ctx.actor.userId))
      .for("share");
    await lockLiveSession(tx, ctx.actor, ctx.clock);
    if (hint.competitionId)
      await tx
        .select({ id: competition.id })
        .from(competition)
        .where(eq(competition.id, hint.competitionId))
        .for("update");
    const { role } = await authorize(
      { ...ctx, db: tx },
      hint.type === "volunteer_service"
        ? "certificates.correct_volunteer"
        : "certificates.correct",
      hint.competitionId
        ? { scopes: [{ type: "competition", id: hint.competitionId }] }
        : {}
    );
    const [row] = await tx
      .select()
      .from(certificate)
      .where(eq(certificate.id, input.certificateId))
      .for("update");
    if (!row || row.competitionId !== hint.competitionId) throw denied();
    if (row.status !== "issued")
      return { ok: false, error: "not_issued" } as const;
    const status = input.recipientName === undefined ? "revoked" : "superseded";
    assertCertificateTransition(row.status, status);
    await tx
      .update(certificate)
      .set({
        status,
        revokedAt: ctx.clock.now(),
        revokedByUserId: ctx.actor.userId,
        revokedReason: input.reason,
      })
      .where(eq(certificate.id, row.id));

    const replacement =
      input.recipientName === undefined
        ? null
        : await insertCertificate(tx, ctx.clock, {
            type: row.type,
            competitionId: row.competitionId,
            registrationId: row.registrationId,
            participantProfileId: row.participantProfileId,
            recipientUserId: row.recipientUserId,
            approvedMinutesSnapshot: row.approvedMinutesSnapshot,
            entryId: row.entryId,
            schoolRoundId: row.schoolRoundId,
            roundId: row.roundId,
            awardPosition: row.awardPosition,
            awardLabel: row.awardLabel,
            nameSnapshot: input.recipientName,
            templateVersion: row.templateVersion,
            sourceReleaseId: row.sourceReleaseId,
          });
    if (replacement) {
      await tx
        .update(certificate)
        .set({ supersededById: replacement.id })
        .where(eq(certificate.id, row.id));
      if (row.competitionId)
        await emit(tx, ctx.clock, {
          type: "certificate.reissued",
          aggregate: { type: "certificate", id: replacement.id },
          payload: { certificateId: replacement.id },
        });
    }
    await invalidateCertificateArchives({ ...ctx, db: tx }, row.id, role);
    await recordAudit(tx, ctx, {
      action: replacement ? "certificate.reissued" : "certificate.revoked",
      entity: { type: "certificate", id: row.id },
      before: { status: row.status },
      after: {
        status,
        reasonRecorded: true,
        supersededById: replacement?.id ?? null,
      },
      actorRole: role,
    });
    return {
      ok: true,
      certificateId: replacement?.id ?? row.id,
      number: replacement?.number ?? row.number,
    } as const;
  });
}
