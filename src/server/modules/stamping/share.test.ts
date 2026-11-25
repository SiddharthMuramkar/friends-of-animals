import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { certificate, guardianLink } from "../../db/schema";
import { SEED_ACCOUNTS } from "../../seed/accounts";
import { SEED_GUARDIANS } from "../../seed/guardians";
import { signedInWith, managerOf } from "../judging/testing";
import { SEED_RESULTS } from "../../seed/results";

it("renders private share images of issued certificates, allows the recipient and verified guardian only, and refuses a revoked certificate", async () => {
  const h = await createHarness();
  await h.seed.preview();
  await h.drain();
  const adult = await h.signIn(
    await h.seed.member({ email: SEED_ACCOUNTS.members[0]!.email })
  );
  const guardian = await h.signIn(
    await h.seed.member({ email: SEED_GUARDIANS.guardian.email })
  );
  const manager = await signedInWith(h, managerOf(SEED_RESULTS.competitionId));
  const [mine] = await h.as(adult).listMyCertificates();
  const [child] = await h.as(guardian).listMyCertificates();
  const input = { certificateId: mine!.id };
  expect(await h.as(adult).requestCertificateShare(input)).toMatchObject({
    ok: true,
  });
  expect(await h.as(adult).requestCertificateShare(input)).toMatchObject({
    ok: true,
  });
  await h.drain();
  const share = await h.as(adult).getCertificateShareUrl(input);
  if (!share.ok) throw Error(share.error);
  expect(await h.storage.get(share.url)).toMatchObject({
    ok: true,
    contentType: "image/png",
    contentDisposition: `attachment; filename="${mine!.number}.png"`,
  });
  expect(
    await h.as(guardian).requestCertificateShare({ certificateId: child!.id })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(
    await h.as(guardian).getCertificateShareUrl({ certificateId: child!.id })
  ).toMatchObject({ ok: true });
  for (const actor of [guardian, manager, h.visitor()]) {
    await expect(
      h.as(actor).requestCertificateShare(input)
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as(actor).getCertificateShareUrl(input)
    ).rejects.toMatchObject({ code: "forbidden" });
  }
  await h.db
    .update(certificate)
    .set({
      status: "revoked",
      revokedAt: h.clock.now(),
      revokedReason: "Corrected award",
    })
    .where(eq(certificate.id, mine!.id));
  expect(await h.as(adult).getCertificateShareUrl(input)).toMatchObject({
    ok: false,
    error: "not_ready",
  });
  expect(await h.as(adult).requestCertificateShare(input)).toMatchObject({
    ok: false,
    error: "not_ready",
  });
  await h.db
    .update(guardianLink)
    .set({ revokedAt: h.clock.now() })
    .where(eq(guardianLink.participantProfileId, child!.participantProfileId!));
  await expect(
    h.as(guardian).getCertificateShareUrl({ certificateId: child!.id })
  ).rejects.toMatchObject({ code: "forbidden" });
});
