import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createHarness, type Harness } from "@/test/harness";
import {
  auditLog,
  certificate,
  certificateReadyNotice,
  fileAsset,
  guardianLink,
  outbox,
  participantProfile,
  resultRelease,
} from "../../db/schema";
import { SEED_RESULTS } from "../../seed/results";
import { SEED_GUARDIANS } from "../../seed/guardians";
import { SEED_ACCOUNTS } from "../../seed/accounts";
import { managerOf, signedInWith } from "../judging/testing";
const worker = { kind: "system", process: "worker" } as const;
async function seeded(h: Harness) {
  await h.seed.preview();
  const [release] = await h.db
    .select()
    .from(resultRelease)
    .where(eq(resultRelease.id, SEED_RESULTS.releaseId));
  if (!release?.publishedAt) throw Error("Missing seeded release");
  const manager = await signedInWith(h, managerOf(SEED_RESULTS.competitionId));
  const adult = await h.signIn(
    await h.seed.member({ email: SEED_ACCOUNTS.members[0]!.email })
  );
  const guardian = await h.signIn(
    await h.seed.member({ email: SEED_GUARDIANS.guardian.email })
  );
  return {
    input: {
      competitionId: SEED_RESULTS.competitionId,
      releaseId: SEED_RESULTS.releaseId,
      publishedAt: release.publishedAt.toISOString(),
    },
    manager,
    adult,
    guardian,
  };
}
it("issues the seeded released awards once, renders private PDFs, and notifies a guardian once for both children", async () => {
  const h = await createHarness();
  const { input, manager, adult, guardian } = await seeded(h);
  const api = h.as(manager);
  const all = await api.listCertificates({
    competitionId: input.competitionId,
  });
  expect(all).toHaveLength(16);
  expect(all.filter((c) => c.type === "participation")).toHaveLength(9);
  expect(new Set(all.map((c) => c.number)).size).toBe(16);
  expect(
    all.every((c) => /^FOA-C-\d{2}-[0-9A-HJKMNP-TV-Z]{10}$/.test(c.number))
  ).toBe(true);
  expect(await h.as(worker).issueCertificates(input)).toEqual({ issued: 0 });
  await expect(h.as(adult).issueCertificates(input)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    h.as(adult).listCertificates({ competitionId: input.competitionId })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(h.as(adult).listCertificateCompetitions()).rejects.toMatchObject(
    { code: "forbidden" }
  );
  await expect(
    h.as(adult).renderCertificate({ certificateId: all[0]!.id })
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await api.listCertificateCompetitions()).toContainEqual(
    expect.objectContaining({ id: input.competitionId })
  );
  const other = await signedInWith(
    h,
    managerOf("01938a00-0000-7000-8000-000000000001")
  );
  await expect(
    h.as(other).listCertificates({ competitionId: input.competitionId })
  ).rejects.toMatchObject({ code: "forbidden" });
  await h.drain();
  expect(
    (await api.listCertificates({ competitionId: input.competitionId })).every(
      (c) => c.renderStatus === "rendered"
    )
  ).toBe(true);
  expect(
    h.pdf.rendered.filter((j) => j.data.type !== "volunteer_service")
  ).toHaveLength(16);
  expect(
    h.pdf.rendered.filter((j) => j.data.type === "volunteer_service")
  ).toHaveLength(1);
  expect(
    h.pdf.rendered.every((j) =>
      j.data.verifyUrl.endsWith(`/verify/${j.data.number}`)
    )
  ).toBe(true);
  const adultCerts = await h.as(adult).listMyCertificates();
  const childCerts = await h.as(guardian).listMyCertificates();
  expect(adultCerts).toHaveLength(2);
  expect(childCerts).toHaveLength(4);
  expect(new Set(childCerts.map((c) => c.participantProfileId!)).size).toBe(2);
  const item = adultCerts[0]!;
  const result = await h
    .as(adult)
    .getCertificateDownloadUrl({ certificateId: item.id });
  if (!result.ok) throw Error(result.error);
  expect(result.expiresAt.getTime() - h.clock.now().getTime()).toBe(300000);
  expect(await h.storage.get(result.url)).toMatchObject({
    ok: true,
    contentType: "application/pdf",
    contentDisposition: `attachment; filename="${item.number}.pdf"`,
  });
  expect(
    await h
      .as(guardian)
      .getCertificateDownloadUrl({ certificateId: childCerts[0]!.id })
  ).toMatchObject({ ok: true });
  for (const actor of [guardian, manager, h.visitor(), other])
    await expect(
      h.as(actor).getCertificateDownloadUrl({ certificateId: item.id })
    ).rejects.toMatchObject({ code: "forbidden" });
  await expect(h.as(h.visitor()).listMyCertificates()).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await h.as(other).listMyCertificates()).toEqual([]);
  const [stored] = await h.db
    .select()
    .from(certificate)
    .where(eq(certificate.id, item.id));
  expect(
    await h
      .as(
        await signedInWith(h, {
          role: "staff_admin",
          scope: { type: "global" },
        })
      )
      .getFileDownloadUrl({ fileId: stored!.pdfFileId! })
  ).toMatchObject({ ok: false, error: "not_found" });
  const notices = await h.db
    .select()
    .from(certificateReadyNotice)
    .where(eq(certificateReadyNotice.releaseId, input.releaseId));
  expect(
    notices.filter(
      (n) => guardian.kind === "user" && n.recipientUserId === guardian.userId
    )
  ).toHaveLength(1);
  expect(
    notices.some((n) => n.recipientUserId === SEED_GUARDIANS.teen.id)
  ).toBe(false);
  expect(
    h.email.sent.filter(
      (m) =>
        m.to === SEED_GUARDIANS.guardian.email &&
        m.subject === "Your certificates are ready"
    )
  ).toHaveLength(1);
  await h.as(worker).renderCertificate({ certificateId: item.id });
  await h.drain();
  expect(
    h.pdf.rendered.filter((j) => j.data.type !== "volunteer_service")
  ).toHaveLength(16);
  expect(
    h.pdf.rendered.filter((j) => j.data.type === "volunteer_service")
  ).toHaveLength(1);
  expect(await h.as(worker).issueCertificates(input)).toEqual({ issued: 0 });
  expect(
    await h.db
      .select()
      .from(fileAsset)
      .innerJoin(certificate, eq(certificate.pdfFileId, fileAsset.id))
      .where(
        and(
          eq(fileAsset.purpose, "certificate_pdf"),
          eq(certificate.competitionId, input.competitionId)
        )
      )
  ).toHaveLength(16);
  expect(
    await h.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, item.id),
          eq(auditLog.action, "certificate.downloaded")
        )
      )
  ).toHaveLength(1);
  await h.db
    .update(guardianLink)
    .set({ revokedAt: h.clock.now() })
    .where(
      eq(
        guardianLink.participantProfileId,
        childCerts[0]!.participantProfileId!
      )
    );
  await expect(
    h
      .as(guardian)
      .getCertificateDownloadUrl({ certificateId: childCerts[0]!.id })
  ).rejects.toMatchObject({ code: "forbidden" });
});
it("separates validity from PDF failure, retries through staff, and limits public lookup", async () => {
  const h = await createHarness();
  const { input, manager, adult } = await seeded(h);
  const api = h.as(manager);
  const all = await api.listCertificates({
    competitionId: input.competitionId,
  });
  const c = (await h.as(adult).listMyCertificates())[0]!;
  expect(
    await h.as(adult).getCertificateDownloadUrl({ certificateId: c.id })
  ).toMatchObject({ ok: false, error: "not_ready" });
  h.pdf.failNext(3);
  for (let i = 0; i < 2; i++)
    await expect(
      h.as(worker).renderCertificate({ certificateId: c.id })
    ).rejects.toThrow("PDF renderer");
  await h.as(worker).renderCertificate({ certificateId: c.id });
  expect(
    await api.listCertificates({
      competitionId: input.competitionId,
      renderStatus: "failed",
    })
  ).toMatchObject([{ id: c.id, status: "issued", renderStatus: "failed" }]);
  await expect(
    h.as(adult).retryCertificateRender({ certificateId: c.id })
  ).rejects.toMatchObject({ code: "forbidden" });
  const visitor = h.as(h.visitor({ ip: "203.0.113.70" }));
  const valid = await visitor.verifyCertificate({
    number: c.number.toLowerCase().replaceAll("-", " "),
  });
  expect(valid).toMatchObject({
    outcome: "valid",
    number: c.number,
    credit: { name: "Asha Rao" },
  });
  await h.db
    .update(participantProfile)
    .set({ fullName: "Corrected private name" })
    .where(eq(participantProfile.id, c.participantProfileId!));
  expect(await visitor.verifyCertificate({ number: c.number })).toMatchObject({
    outcome: "valid",
    credit: null,
  });
  expect(JSON.stringify(valid)).not.toContain(c.participantProfileId!);
  for (const forbidden of [
    "dateOfBirth",
    "storageKey",
    "nameSnapshot",
    "registrationId",
    "email",
    "school",
    "city",
  ])
    expect(JSON.stringify(valid)).not.toContain(forbidden);
  expect(await api.retryCertificateRender({ certificateId: c.id })).toEqual({
    ok: true,
  });
  await h.drain();
  expect(
    await h.as(adult).getCertificateDownloadUrl({ certificateId: c.id })
  ).toMatchObject({ ok: true });
  expect(
    await api.retryCertificateRender({ certificateId: c.id })
  ).toMatchObject({ ok: false, error: "not_retryable" });
  const ip = h.as(h.visitor({ ip: "203.0.113.71" }));
  for (let i = 0; i < 30; i++)
    expect(await ip.verifyCertificate({ number: "invalid" })).toEqual({
      outcome: "unknown",
    });
  expect(await ip.verifyCertificate({ number: c.number })).toMatchObject({
    outcome: "rate_limited",
  });
  expect(
    await visitor.verifyCertificate({ number: "FOA-C-27-0000000000" })
  ).toEqual({ outcome: "unknown" });
  h.clock.advance({ minutes: 1 });
  expect(await ip.verifyCertificate({ number: c.number })).toMatchObject({
    outcome: "valid",
  });
  await h.db
    .update(certificate)
    .set({
      status: "revoked",
      revokedAt: h.clock.now(),
      revokedReason: "Private reason",
    })
    .where(eq(certificate.id, c.id));
  expect(await visitor.verifyCertificate({ number: c.number })).toEqual({
    outcome: "revoked",
    number: c.number,
  });
  expect(
    await h.as(adult).getCertificateDownloadUrl({ certificateId: c.id })
  ).toMatchObject({ ok: false, error: "not_ready" });
  expect(await h.as(worker).issueCertificates(input)).toEqual({ issued: 0 });
  expect(
    await api.listCertificates({ competitionId: input.competitionId })
  ).toHaveLength(all.length);
  expect(
    await h.db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.aggregateId, c.id),
          eq(outbox.eventType, "certificate.render")
        )
      )
  ).toHaveLength(2);
});
