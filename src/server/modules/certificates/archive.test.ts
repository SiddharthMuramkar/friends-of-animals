import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createHarness, type Harness } from "@/test/harness";
import {
  certificate,
  certificateArchive,
  institution,
  registration,
} from "../../db/schema";
import { enrol } from "../payments/testing";
import { confirmedSchool } from "../institution-submissions/testing";
import { signedInOfficer } from "../privacy/requests/testing";
import { managerOf, signedInWith } from "../judging/testing";
import { anotherSchool } from "../school-round/testing";
import { insertCertificate } from "./issue";
import { readZip } from "../privacy/requests/subject-data/read-zip";

const worker = { kind: "system", process: "worker" } as const;
async function certificateFor(h: Harness, registrationId: string) {
  const [row] = await h.db
    .select()
    .from(registration)
    .where(eq(registration.id, registrationId));
  if (!row) throw Error("Fixture missing registration");
  return insertCertificate(h.db, h.clock, {
    competitionId: row.competitionId,
    registrationId: row.id,
    participantProfileId: row.participantProfileId,
    type: "participation",
    nameSnapshot: "Private recipient",
  });
}
it("builds exactly the current institution's rendered certificates in the background, rejects wrong scopes and stale links, and expires archives", async () => {
  const h = await createHarness();
  const school = await confirmedSchool(h, { students: 2 });
  const other = await anotherSchool(h, school.competition.id);
  const otherId = await enrol(h, { ...school, ...other }, 3);
  expect(
    await h.as(other.coordinator.actor).payInstitutionFees(other.ref)
  ).toMatchObject({ ok: true });
  const foreign = await certificateFor(h, otherId);
  const certs = await Promise.all(
    school.registrationIds.map((id) => certificateFor(h, id))
  );
  // Same competition, different institution. This coordinator cannot obtain the first school's ZIP.
  const coord = h.as(school.coordinator.actor);
  const ref = {
    institutionId: school.institutionId,
    reference: school.reference,
  };
  const manager = h.as(await signedInWith(h, managerOf(school.competition.id)));
  const wrong = h.as(other.coordinator.actor);
  await expect(
    wrong.requestInstitutionCertificateArchive(ref)
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    manager.requestInstitutionCertificateArchive(ref)
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    wrong.getInstitutionCertificateArchive(ref)
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await coord.requestInstitutionCertificateArchive(ref)).toMatchObject({
    ok: false,
    error: "not_ready",
  });
  await h.drain();
  const asked = await coord.requestInstitutionCertificateArchive(ref);
  expect(asked).toMatchObject({ ok: true, status: "pending" });
  if (!asked.ok) throw Error("No archive");
  expect(await coord.requestInstitutionCertificateArchive(ref)).toEqual(asked);
  await expect(
    wrong.getInstitutionCertificateArchiveLink({ archiveId: asked.archiveId })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    wrong.buildInstitutionCertificateArchive({ archiveId: asked.archiveId })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    wrong.expireInstitutionCertificateArchive({ archiveId: asked.archiveId })
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(
    await coord.getInstitutionCertificateArchiveLink({
      archiveId: asked.archiveId,
    })
  ).toMatchObject({ ok: false, error: "not_ready" });
  await h.drain();
  expect(await coord.getInstitutionCertificateArchive(ref)).toMatchObject({
    ok: true,
    count: 2,
    archive: { id: asked.archiveId, status: "ready" },
  });
  const link = await coord.getInstitutionCertificateArchiveLink({
    archiveId: asked.archiveId,
  });
  if (!link.ok) throw Error("No signed ZIP");
  const downloaded = await h.storage.get(link.url);
  if (!downloaded.ok) throw Error("ZIP missing");
  expect(downloaded.contentType).toBe("application/zip");
  expect(readZip(downloaded.bytes).names.sort()).toEqual(
    certs.map((c) => c.number + ".pdf").sort()
  );
  expect(readZip(downloaded.bytes).names).not.toContain(
    foreign.number + ".pdf"
  );
  await h
    .as(worker)
    .buildInstitutionCertificateArchive({ archiveId: asked.archiveId });
  expect(
    await coord.getInstitutionCertificateArchiveLink({
      archiveId: asked.archiveId,
    })
  ).toMatchObject({ ok: true });
  expect(
    await manager.revokeCertificate({
      certificateId: certs[0]!.id,
      reason: "Issued in error",
    })
  ).toMatchObject({ ok: true });
  expect(
    await coord.getInstitutionCertificateArchiveLink({
      archiveId: asked.archiveId,
    })
  ).toMatchObject({ ok: false });
  const replaced = await manager.reissueCertificate({
    certificateId: certs[1]!.id,
    reason: "Spelling correction",
    recipientName: "Corrected recipient",
  });
  if (!replaced.ok) throw Error("Replacement unavailable");
  expect(await coord.requestInstitutionCertificateArchive(ref)).toMatchObject({
    ok: false,
    error: "not_ready",
  });
  await h.drain();
  expect(h.email.sent).toContainEqual(
    expect.objectContaining({
      to: "guardian-2@example.test",
      subject: "Your certificate has been reissued",
    })
  );
  expect(await h.storage.get(link.url)).toMatchObject({ ok: false });
  const rerun = await coord.requestInstitutionCertificateArchive(ref);
  if (!rerun.ok) throw Error("No fresh archive");
  expect(rerun.archiveId).not.toBe(asked.archiveId);
  await h.drain();
  const newLink = await coord.getInstitutionCertificateArchiveLink({
    archiveId: rerun.archiveId,
  });
  if (!newLink.ok) throw Error("No fresh signed ZIP");
  const fresh = await h.storage.get(newLink.url);
  if (!fresh.ok) throw Error("Missing archive");
  expect(readZip(fresh.bytes).names).toEqual([replaced.number + ".pdf"]);
  await h.db
    .update(institution)
    .set({ status: "suspended", statusReason: "Under review" })
    .where(eq(institution.id, school.institutionId));
  await expect(
    coord.getInstitutionCertificateArchiveLink({ archiveId: rerun.archiveId })
  ).rejects.toMatchObject({ code: "forbidden" });
  await h.db
    .update(institution)
    .set({ status: "verified", statusReason: "Reinstated" })
    .where(eq(institution.id, school.institutionId));
  const superAdmin = await h.signIn(await h.seed.superAdmin());
  expect(
    await h.as(superAdmin).revokeRole({
      userId: school.coordinator.userId,
      role: "institution_coordinator",
      scope: { type: "institution", id: school.institutionId },
    })
  ).toMatchObject({ ok: true });
  await expect(
    coord.getInstitutionCertificateArchiveLink({ archiveId: rerun.archiveId })
  ).rejects.toMatchObject({ code: "forbidden" });
  const admin = h.as(await h.signIn(school.admin));
  expect(
    await admin.getInstitutionCertificateArchiveLink({
      archiveId: rerun.archiveId,
    })
  ).toMatchObject({ ok: true });
  h.clock.advance({ days: 2 });
  await h.drain();
  expect(await h.storage.get(newLink.url)).toMatchObject({ ok: false });
  expect(await admin.getInstitutionCertificateArchive(ref)).toMatchObject({
    ok: true,
    archive: null,
  });
  expect(
    (await h.db.select().from(certificate)).filter((c) => c.status === "issued")
  ).toHaveLength(2);
});

it("expires an archive without delivering it while a subject is on legal hold, then purges it once released", async () => {
  const h = await createHarness();
  const school = await confirmedSchool(h, { students: 1 });
  const c = await certificateFor(h, school.registrationIds[0]!);
  await h.drain();
  const coord = h.as(school.coordinator.actor);
  const ref = {
    institutionId: school.institutionId,
    reference: school.reference,
  };
  const requested = await coord.requestInstitutionCertificateArchive(ref);
  if (!requested.ok) throw Error("Archive unavailable");
  await h.drain();
  const adminAccount = await h.seed.superAdmin();
  const admin = h.as(await h.signIn(adminAccount));
  const hold = await admin.placeLegalHold({
    subjectType: "participant_profile",
    subjectId: c.participantProfileId,
    reason: "Preserve evidence",
  });
  if (!hold.ok) throw Error("Legal hold unavailable");
  h.clock.advance({ days: 2 });
  await h.drain();
  expect(
    await coord.getInstitutionCertificateArchiveLink({
      archiveId: requested.archiveId,
    })
  ).toMatchObject({ ok: false });
  expect(h.storage.keys(h.deps.files.bucket)).toContainEqual(
    expect.stringContaining(requested.archiveId)
  );
  expect(
    await h
      .as(await h.signIn(adminAccount))
      .releaseLegalHold({ holdId: hold.holdId })
  ).toMatchObject({ ok: true });
  h.clock.advance({ days: 2 });
  await h.drain();
  expect(h.storage.keys(h.deps.files.bucket)).not.toContainEqual(
    expect.stringContaining(requested.archiveId)
  );
});

it("erases a pupil's containing ZIP and never includes other pupils' PDFs in their own rights export", async () => {
  const h = await createHarness();
  await h.settings.set("privacy.erasureEnabled", true);
  const school = await confirmedSchool(h, { students: 2 });
  const certs = await Promise.all(
    school.registrationIds.map((id) => certificateFor(h, id))
  );
  await h.drain();
  const coord = h.as(school.coordinator.actor);
  const ref = {
    institutionId: school.institutionId,
    reference: school.reference,
  };
  const requested = await coord.requestInstitutionCertificateArchive(ref);
  if (!requested.ok) throw Error("Archive unavailable");
  await h.drain();
  const link = await coord.getInstitutionCertificateArchiveLink({
    archiveId: requested.archiveId,
  });
  if (!link.ok) throw Error("Archive unavailable");
  const family = await h.seed.guardian({ children: [] });
  await family.linkInstitutionRegistration(school.registrationIds[0]!);
  const guardian = h.as(await h.signIn(family.account));
  const officer = h.as((await signedInOfficer(h)).actor);
  const access = await guardian.submitPrivacyRequest({
    type: "access",
    subject: { kind: "child", childId: certs[0]!.participantProfileId },
  });
  if (!access.ok) throw Error("Access request unavailable");
  await officer.startPrivacyRequest({ id: access.requestId });
  expect(
    await officer.buildSubjectExport({ id: access.requestId })
  ).toMatchObject({ ok: true });
  await h.drain();
  const exportLink = await guardian.getPrivacyExportLink({
    id: access.requestId,
  });
  if (!exportLink.ok) throw Error("Rights export unavailable");
  const exported = await h.storage.get(exportLink.url);
  if (!exported.ok) throw Error("Rights export missing");
  expect(readZip(exported.bytes).allText()).not.toContain(certs[1]!.number);
  expect(
    readZip(exported.bytes).names.every((name) => !name.endsWith(".zip"))
  ).toBe(true);
  const erase = await guardian.submitPrivacyRequest({
    type: "erasure",
    subject: { kind: "child", childId: certs[0]!.participantProfileId },
  });
  if (!erase.ok) throw Error("Erasure request unavailable");
  await officer.startPrivacyRequest({ id: erase.requestId });
  const plan = await officer.previewErasure({ id: erase.requestId });
  if (!plan.ok) throw Error("Erasure preview unavailable");
  expect(
    await officer.executeErasure({
      id: erase.requestId,
      fingerprint: plan.preview.plan.fingerprint,
    })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(await h.storage.get(link.url)).toMatchObject({ ok: false });
  expect(
    await h.db
      .select()
      .from(certificateArchive)
      .where(eq(certificateArchive.id, requested.archiveId))
  ).toHaveLength(0);
  expect(await coord.getInstitutionCertificateArchive(ref)).toMatchObject({
    ok: true,
    count: 1,
    archive: null,
  });
});
