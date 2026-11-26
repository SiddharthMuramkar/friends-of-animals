import { and, asc, eq } from "drizzle-orm";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  certificate,
  CERTIFICATE_NUMBER_UNIQUE,
  competition,
  entry,
  participantProfile,
  registration,
  schoolRound,
  schoolRoundPick,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { emit } from "../../outbox/emit";
import type { EventOf } from "../../outbox/events";
import type { Clock } from "../../ports/clock";
import type { Actor } from "../../actor";
import { withUniqueCode, type RandomBytes } from "../codes/codes";
import { lockSubject } from "../privacy/requests/submit";
import { publishedResults } from "../results/read-published";
import { isSchoolRoundFinished } from "../school-round/domain/status";
import {
  missingCertificates,
  planCertificates,
  type RegistrationFacts,
} from "./domain/eligibility";
import { certificateNumberFormat } from "./domain/number";
export type IssueInput = EventOf<"results.published">["payload"];
export type CertificateContext = { db: AppDb; clock: Clock; actor: Actor };
export async function queueCertificateRender(
  db: AppDb,
  clock: Clock,
  certificateId: string
) {
  await emit(db, clock, {
    type: "certificate.render",
    aggregate: { type: "certificate", id: certificateId },
    payload: { certificateId },
  });
}
/** Insert a new numbered certificate and its media job in the calling transaction. */
export async function insertCertificate(
  db: AppDb,
  clock: Clock,
  values: Omit<typeof certificate.$inferInsert, "id" | "number" | "issuedAt">,
  random?: RandomBytes
) {
  const now = clock.now();
  return withUniqueCode(
    {
      format: certificateNumberFormat(now),
      constraint: CERTIFICATE_NUMBER_UNIQUE,
      ...(random ? { random } : {}),
    },
    (number) =>
      db.transaction(async (tx) => {
        const id = uuidv7(now);
        const [row] = await tx
          .insert(certificate)
          .values({ ...values, id, number, issuedAt: now })
          .returning();
        await queueCertificateRender(tx, clock, id);
        return row!;
      })
  );
}
export async function issueCertificates(
  ctx: CertificateContext,
  input: IssueInput
) {
  await authorize(ctx, "certificates.issue");
  return ctx.db.transaction(async (tx) => {
    // Erasure holds the same subject locks before it gathers files. Acquire
    // them in a stable order before the competition lock, like render and
    // archive jobs, so replay cannot repopulate an erased pupil's bytes.
    const subjects = await tx
      .selectDistinct({ id: registration.participantProfileId })
      .from(registration)
      .where(eq(registration.competitionId, input.competitionId))
      .orderBy(asc(registration.participantProfileId));
    for (const subject of subjects) await lockSubject(tx, subject.id);
    // Every issuance/replay for this competition uses the same lock. The
    // partial unique indexes independently protect the earned identities.
    const [comp] = await tx
      .select()
      .from(competition)
      .where(eq(competition.id, input.competitionId))
      .for("update");
    if (!comp) return { issued: 0 };
    const release = await publishedResults(tx, comp.id);
    if (
      !release ||
      release.releaseId !== input.releaseId ||
      release.publishedAt.toISOString() !== input.publishedAt
    )
      return { issued: 0 };
    const rows = await tx
      .select({
        registration,
        name: participantProfile.fullName,
        identityHash: participantProfile.identityHash,
        entry,
        schoolRound,
        pick: schoolRoundPick,
      })
      .from(registration)
      .innerJoin(
        participantProfile,
        eq(participantProfile.id, registration.participantProfileId)
      )
      .leftJoin(entry, eq(entry.registrationId, registration.id))
      .leftJoin(
        schoolRound,
        eq(
          schoolRound.institutionRegistrationId,
          registration.institutionRegistrationId
        )
      )
      .leftJoin(
        schoolRoundPick,
        and(
          eq(schoolRoundPick.entryId, entry.id),
          eq(schoolRoundPick.roundId, schoolRound.id)
        )
      )
      .where(eq(registration.competitionId, comp.id));
    const facts: RegistrationFacts[] = rows.map((r) => ({
      registrationId: r.registration.id,
      participantProfileId: r.registration.participantProfileId,
      route: r.registration.route,
      standing:
        r.registration.status === "confirmed" &&
        !r.identityHash.startsWith("erased:")
          ? "confirmed"
          : "not_confirmed",
      entryReachedSubmitted: r.entry?.submittedAt != null,
      schoolRound: r.schoolRound
        ? {
            roundId: r.schoolRound.id,
            decided: isSchoolRoundFinished(r.schoolRound.status),
            entryId: r.pick?.entryId ?? null,
            position: r.pick?.position ?? null,
          }
        : null,
    }));
    const expected = planCertificates(
      {
        submissionScope: comp.digitalScope,
        finalRoundId: release.sourceRoundId,
      },
      facts,
      release.lines
    );
    const existing = await tx
      .select()
      .from(certificate)
      .where(eq(certificate.competitionId, comp.id));
    const plan = missingCertificates(
      expected,
      existing.flatMap((r) =>
        r.registrationId && r.type !== "volunteer_service"
          ? [
              {
                registrationId: r.registrationId,
                type: r.type,
                roundId: r.schoolRoundId ?? r.roundId,
              },
            ]
          : []
      )
    );
    for (const p of plan) {
      const award = release.lines.find((line) => line.entryId === p.entryId);
      await insertCertificate(tx, ctx.clock, {
        registrationId: p.registrationId,
        participantProfileId: p.participantProfileId,
        competitionId: comp.id,
        type: p.type,
        entryId: p.entryId,
        schoolRoundId: p.type === "school_merit" ? p.roundId : null,
        roundId: p.type === "school_merit" ? null : p.roundId,
        awardPosition: p.awardPosition,
        awardLabel:
          p.type === "school_merit" ? null : (award?.awardBand ?? null),
        nameSnapshot: rows.find((r) => r.registration.id === p.registrationId)!
          .name,
        sourceReleaseId: release.releaseId,
      });
    }
    if (plan.length)
      await recordAudit(tx, ctx, {
        action: "certificates.issued",
        entity: { type: "result_release", id: release.releaseId },
        before: null,
        after: { count: plan.length, competitionId: comp.id },
        actorRole: null,
      });
    return { issued: plan.length };
  });
}
