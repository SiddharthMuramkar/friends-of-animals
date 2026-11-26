import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createHarness } from "@/test/harness";
import {
  competition,
  judgingRound,
  participantProfile,
  registration,
  resultRelease,
  schoolRound,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { TIE_BREAK_RULE } from "../judging/domain/ranking";
import { capturedBatch } from "../payments/refunds/testing";
import { signedInOfficer } from "../privacy/requests/testing";

it("a replay of the published shortlist-only release cannot issue a new certificate to an erased, financially retained pupil", async () => {
  const h = await createHarness();
  await h.settings.set("privacy.erasureEnabled", true);
  const paid = await capturedBatch(h, { students: 1 });
  const { school } = paid;
  const [pupil] = await h.db
    .select()
    .from(registration)
    .where(eq(registration.id, paid.registrationIds[0]!));
  if (!pupil) throw Error("Missing registration");
  const now = h.clock.now();
  const yesterday = new Date(now.getTime() - 86400000);
  const roundId = uuidv7(now),
    releaseId = uuidv7(now),
    competitionId = school.competition.id;
  // Established publication fixture: the paid pupil took part in their
  // school's decided shortlist-only round but did not advance.
  await h.db
    .update(competition)
    .set({ digitalScope: "shortlist_only", status: "results_published" })
    .where(eq(competition.id, competitionId));
  await h.db.insert(schoolRound).values({
    id: uuidv7(now),
    competitionId,
    institutionRegistrationId: school.registrationId,
    status: "closed_on_behalf",
    closeReason: "Decided local round",
    openedAt: yesterday,
    closedAt: yesterday,
    createdAt: yesterday,
    updatedAt: yesterday,
  });
  await h.db.insert(judgingRound).values({
    id: roundId,
    competitionId,
    name: "Final",
    nameKey: "final",
    status: "locked",
    lockedAt: yesterday,
    tieBreakRule: TIE_BREAK_RULE,
    createdAt: yesterday,
    updatedAt: yesterday,
    lockOverrideReason: "No finalists",
  });
  await h.db.insert(resultRelease).values({
    id: releaseId,
    competitionId,
    sourceRoundId: roundId,
    status: "published",
    preparedAt: yesterday,
    approvedAt: yesterday,
    publishAt: now,
    publishedAt: now,
    contentHash: "fixture",
    deliveryNote: "None",
  });
  const input = { competitionId, releaseId, publishedAt: now.toISOString() };
  const system = h.as({ kind: "system", process: "worker" });
  expect(await system.issueCertificates(input)).toEqual({ issued: 1 });
  await h.drain();
  const family = await h.seed.guardian({ children: [] });
  await family.linkInstitutionRegistration(pupil.id);
  const guardian = h.as(await h.signIn(family.account));
  const [original] = await guardian.listMyCertificates();
  expect(original?.downloadable).toBe(true);
  const request = await guardian.submitPrivacyRequest({
    type: "erasure",
    subject: { kind: "child", childId: pupil.participantProfileId },
  });
  if (!request.ok) throw Error("Missing erasure request");
  const officer = h.as((await signedInOfficer(h)).actor);
  await officer.startPrivacyRequest({ id: request.requestId });
  const plan = await officer.previewErasure({ id: request.requestId });
  if (!plan.ok) throw Error("Missing erasure plan");
  expect(
    await officer.executeErasure({
      id: request.requestId,
      fingerprint: plan.preview.plan.fingerprint,
    })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(
    await h.as(h.visitor()).verifyCertificate({ number: original!.number })
  ).toEqual({ outcome: "unknown" });
  // The fee cannot disappear with personal data: the same registration
  // survives, but its pseudonymous accounting reference earns no certificate.
  expect(
    (
      await h.db
        .select()
        .from(registration)
        .where(eq(registration.id, pupil.id))
    )[0]
  ).toMatchObject({ status: "confirmed" });
  expect(
    (
      await h.db
        .select()
        .from(participantProfile)
        .where(eq(participantProfile.id, pupil.participantProfileId))
    )[0]?.identityHash
  ).toMatch(/^erased:/);
  expect(await system.issueCertificates(input)).toEqual({ issued: 0 });
  await h.drain();
  expect(
    await h
      .as(school.coordinator.actor)
      .getInstitutionCertificateArchive(school.ids)
  ).toMatchObject({ count: 0, archive: null });
});
