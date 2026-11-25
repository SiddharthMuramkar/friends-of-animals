import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createHarness } from "@/test/harness";
import { auditLog, certificate, resultRelease } from "../../db/schema";
import { SEED_RESULTS } from "../../seed/results";
import { SEED_ACCOUNTS } from "../../seed/accounts";
import { SEED_GUARDIANS } from "../../seed/guardians";
import { managerOf, signedInWith } from "../judging/testing";

const worker = { kind: "system", process: "worker" } as const;
it("requires a reason and competition-manager authority; revocation and reissue end the old number permanently", async () => {
  const h = await createHarness();
  await h.seed.preview();
  await h.drain();
  const manager = await signedInWith(h, managerOf(SEED_RESULTS.competitionId));
  const other = await signedInWith(
    h,
    managerOf("01938a00-0000-7000-8000-000000000001")
  );
  const participant = await h.signIn(
    await h.seed.member({ email: SEED_ACCOUNTS.members[0].email })
  );
  const guardian = await h.signIn(
    await h.seed.member({ email: SEED_GUARDIANS.guardian.email })
  );
  const unverifiedManager = await h.seed.member();
  await h.seed.grant(unverifiedManager, managerOf(SEED_RESULTS.competitionId));
  const withoutFactor = h.as(
    await h.signIn(unverifiedManager, {}, { secondFactor: false })
  );
  const api = h.as(manager);
  const [adult, another] = await h.as(participant).listMyCertificates();
  const child = (await h.as(guardian).listMyCertificates())[0]!;
  const verify = h.as(h.visitor());
  await expect(
    withoutFactor.revokeCertificate({
      certificateId: adult!.id,
      reason: "Issued in error",
    })
  ).rejects.toMatchObject({ code: "enrolment_required" });
  await expect(
    api.reissueCertificate({
      certificateId: child.id,
      reason: "Correction",
      recipientName: "\u0000",
    })
  ).resolves.toMatchObject({ ok: false, error: "invalid_input" });
  expect(
    await verify.verifyCertificate({ number: adult!.number })
  ).toMatchObject({ outcome: "valid" });
  await expect(
    api.revokeCertificate({ certificateId: adult!.id, reason: "  " })
  ).resolves.toMatchObject({ ok: false });
  for (const actor of [participant, other, h.visitor()]) {
    await expect(
      h.as(actor).revokeCertificate({
        certificateId: adult!.id,
        reason: "Issued in error",
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as(actor).reissueCertificate({
        certificateId: child.id,
        reason: "Spelling error",
        recipientName: "Corrected child name",
      })
    ).rejects.toMatchObject({ code: "forbidden" });
  }
  expect(
    await h
      .as(participant)
      .requestCertificateShare({ certificateId: adult!.id })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(
    await h.as(participant).getCertificateShareUrl({ certificateId: adult!.id })
  ).toMatchObject({ ok: true });
  expect(
    await api.revokeCertificate({
      certificateId: adult!.id,
      reason: "Issued in error",
    })
  ).toMatchObject({ ok: true });
  expect(
    await h
      .as(participant)
      .requestCertificateShare({ certificateId: adult!.id })
  ).toMatchObject({ ok: false, error: "not_ready" });
  expect(
    await h.as(participant).getCertificateShareUrl({ certificateId: adult!.id })
  ).toMatchObject({ ok: false, error: "not_ready" });
  expect(
    (
      await h.db.select().from(certificate).where(eq(certificate.id, adult!.id))
    )[0]
  ).toMatchObject({ status: "revoked", revokedReason: "Issued in error" });
  const revocations = await h.db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityId, adult!.id),
        eq(auditLog.action, "certificate.revoked")
      )
    );
  expect(revocations).toHaveLength(1);
  expect(revocations[0]).toMatchObject({
    actorRole: "competition_manager",
    before: { status: "issued" },
    after: { status: "revoked", reasonRecorded: true },
  });
  expect(JSON.stringify(revocations)).not.toContain("Issued in error");
  expect(await verify.verifyCertificate({ number: adult!.number })).toEqual({
    outcome: "revoked",
    number: adult!.number,
  });
  expect(
    await api.revokeCertificate({
      certificateId: adult!.id,
      reason: "Repeated",
    })
  ).toMatchObject({ ok: false });
  expect(
    await api.reissueCertificate({
      certificateId: adult!.id,
      reason: "Spelling error",
      recipientName: "Name",
    })
  ).toMatchObject({ ok: false });
  expect(
    await h
      .as(participant)
      .getCertificateDownloadUrl({ certificateId: adult!.id })
  ).toMatchObject({ ok: false });
  const corrected = await api.reissueCertificate({
    certificateId: child.id,
    reason: "Spelling error for private child",
    recipientName: "Corrected child name",
  });
  expect(corrected).toMatchObject({ ok: true });
  if (!corrected.ok) throw Error("Correction failed");
  expect(corrected.number).not.toBe(child.number);
  expect(await verify.verifyCertificate({ number: child.number })).toEqual({
    outcome: "revoked",
    number: child.number,
  });
  expect(
    await verify.verifyCertificate({ number: corrected.number })
  ).toMatchObject({ outcome: "valid", type: child.type, credit: null });
  expect(
    await api.reissueCertificate({
      certificateId: child.id,
      reason: "Repeated",
      recipientName: "Other name",
    })
  ).toMatchObject({ ok: false });
  expect(
    await api.revokeCertificate({ certificateId: child.id, reason: "Repeated" })
  ).toMatchObject({ ok: false });
  await h.drain();
  expect(await h.as(guardian).listMyCertificates()).toContainEqual(
    expect.objectContaining({
      number: corrected.number,
      recipientName: "Corrected child name",
      downloadable: true,
    })
  );
  expect(
    await h.as(guardian).getCertificateDownloadUrl({ certificateId: child.id })
  ).toMatchObject({ ok: false });
  expect(h.email.sent).toContainEqual(
    expect.objectContaining({
      to: SEED_GUARDIANS.guardian.email,
      subject: "Your certificate has been reissued",
    })
  );
  expect(h.email.sent).not.toContainEqual(
    expect.objectContaining({
      to: SEED_GUARDIANS.teen.email,
      subject: "Your certificate has been reissued",
    })
  );
  const [release] = await h.db
    .select()
    .from(resultRelease)
    .where(eq(resultRelease.id, SEED_RESULTS.releaseId));
  expect(
    await h.as(worker).issueCertificates({
      competitionId: SEED_RESULTS.competitionId,
      releaseId: SEED_RESULTS.releaseId,
      publishedAt: release!.publishedAt!.toISOString(),
    })
  ).toEqual({ issued: 0 });
  const audits = await h.db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityId, child.id),
        eq(auditLog.action, "certificate.reissued")
      )
    );
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits)).not.toContain("Corrected child name");
  expect(JSON.stringify(audits)).not.toContain("private child");
  expect(
    (
      await h.db.select().from(certificate).where(eq(certificate.id, child.id))
    )[0]
  ).toMatchObject({
    status: "superseded",
    supersededById: corrected.certificateId,
    revokedReason: "Spelling error for private child",
  });
  expect(
    await verify.verifyCertificate({ number: another!.number })
  ).toMatchObject({ outcome: "valid" });
  const adultReplacement = await api.reissueCertificate({
    certificateId: another!.id,
    reason: "Spelling correction",
    recipientName: "Corrected adult name",
  });
  if (!adultReplacement.ok) throw Error("Adult replacement unavailable");
  await h.drain();
  expect(h.email.sent).toContainEqual(
    expect.objectContaining({
      to: SEED_ACCOUNTS.members[0].email,
      subject: "Your certificate has been reissued",
    })
  );
  expect(
    await verify.verifyCertificate({ number: another!.number })
  ).toMatchObject({ outcome: "revoked" });
  expect(
    await verify.verifyCertificate({ number: adultReplacement.number })
  ).toMatchObject({ outcome: "valid", credit: null });
  h.clock.advance({ minutes: 11 });
  await expect(
    api.revokeCertificate({
      certificateId: adultReplacement.certificateId,
      reason: "No fresh factor",
    })
  ).rejects.toMatchObject({ code: "step_up_required" });
});
