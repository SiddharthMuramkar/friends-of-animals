import { and, desc, eq, ne, or } from "drizzle-orm";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import {
  certificate,
  participantProfile,
  user,
  volunteerApplication,
} from "../../db/schema";
import { DomainError } from "../../errors";
import type { UseCaseContext } from "../../use-cases";
import { insertCertificate } from "../certificates/issue";
import { lockSubject } from "../privacy/requests/submit";
import { decideVolunteerCertificate } from "./domain/volunteer-certificate";
import { approvedMinutes } from "./domain/hours";
import { entriesFor, lockVolunteer } from "./work";

export async function requestVolunteerCertificate(ctx: UseCaseContext) {
  await authorize(ctx, "volunteer.work.own");
  if (ctx.actor.kind !== "user")
    throw new DomainError("forbidden", "Volunteer access denied");
  const uid = ctx.actor.userId;
  return ctx.db.transaction(async (tx) => {
    await lockVolunteer(tx, uid);
    const { role } = await authorize({ ...ctx, db: tx }, "volunteer.work.own");
    const [account] = await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, uid));
    if (!account) throw new DomainError("forbidden", "Volunteer access denied");
    // A verified teen's service belongs to their actual profile. An adult
    // needs no participant profile, even when they have never competed.
    const [profile] = await tx
      .select({ id: participantProfile.id, name: participantProfile.fullName })
      .from(participantProfile)
      .innerJoin(
        volunteerApplication,
        eq(volunteerApplication.participantProfileId, participantProfile.id)
      )
      .where(
        and(
          eq(volunteerApplication.applicantUserId, uid),
          eq(volunteerApplication.status, "approved"),
          eq(participantProfile.loginUserId, uid),
          eq(participantProfile.ownerKind, "guardian")
        )
      )
      .limit(1);
    if (profile) await lockSubject(tx, profile.id);
    const minutes = approvedMinutes(
      (await entriesFor(tx, uid)).map((r) => r.entry)
    );
    if (!minutes) return { ok: false, error: "nothing_to_certify" } as const;
    const [existing] = await tx
      .select()
      .from(certificate)
      .where(
        and(
          eq(certificate.type, "volunteer_service"),
          ne(certificate.status, "superseded"),
          profile
            ? or(
                eq(certificate.participantProfileId, profile.id),
                eq(certificate.recipientUserId, uid)
              )
            : eq(certificate.recipientUserId, uid)
        )
      )
      .orderBy(
        desc(certificate.approvedMinutesSnapshot),
        desc(certificate.issuedAt),
        desc(certificate.id)
      )
      .limit(1);
    // A revoked certificate is terminal. Re-requesting the same approved
    // total cannot bypass staff correction; a changed total is a new fact.
    const decision = decideVolunteerCertificate({
      approvedMinutes: minutes,
      latest: existing
        ? {
            certificateId: existing.id,
            approvedMinutesSnapshot: existing.approvedMinutesSnapshot!,
          }
        : null,
    });
    if (decision.kind === "existing" && existing) {
      if (existing.status === "revoked")
        return { ok: false, error: "certificate_revoked" } as const;
      return {
        ok: true,
        certificateId: existing.id,
        number: existing.number,
        approvedMinutes: minutes,
      } as const;
    }
    if (decision.kind === "nothing_to_certify")
      return { ok: false, error: "nothing_to_certify" } as const;
    const row = await insertCertificate(tx, ctx.clock, {
      type: "volunteer_service",
      participantProfileId: profile?.id ?? null,
      recipientUserId: profile ? null : uid,
      approvedMinutesSnapshot: minutes,
      nameSnapshot: profile?.name ?? account.name,
    });
    await recordAudit(tx, ctx, {
      action: "volunteer.certificate_issued",
      entity: { type: "certificate", id: row.id },
      before: null,
      after: { type: row.type },
      actorRole: role,
    });
    return {
      ok: true,
      certificateId: row.id,
      number: row.number,
      approvedMinutes: minutes,
    } as const;
  });
}
