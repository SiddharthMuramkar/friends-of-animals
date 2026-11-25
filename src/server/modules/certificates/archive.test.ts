import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createHarness, type Harness } from "@/test/harness";
import { certificate, institution, registration } from "../../db/schema";
import { confirmedSchool } from "../institution-submissions/testing";
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
  const own = await h.db
    .select()
    .from(registration)
    .where(eq(registration.institutionRegistrationId, school.registrationId));
  const certs = await Promise.all(own.map((row) => certificateFor(h, row.id)));
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
  expect(readZip(fresh.bytes).names).toEqual([certs[1]!.number + ".pdf"]);
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
  h.clock.advance({ days: 2 });
  await h.drain();
  expect(await h.storage.get(newLink.url)).toMatchObject({ ok: false });
  expect(await coord.getInstitutionCertificateArchive(ref)).toMatchObject({
    ok: true,
    archive: null,
  });
  expect(
    (await h.db.select().from(certificate)).filter((c) => c.status === "issued")
  ).toHaveLength(1);
});
