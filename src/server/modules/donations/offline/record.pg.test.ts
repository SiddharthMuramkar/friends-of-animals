import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { istDate } from "../../payments/domain/offline-payment";

let world: PgWorld;
beforeAll(async () => {
  world = createPgWorld();
  await world.deps.settings.set("donations.enabled", true);
  await world.deps.settings.set("org.has80G", false);
});
afterAll(async () => world.close());

it("racing saves of the same uploaded proof allocate only one receipt and posting", async () => {
  const account = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(account, {
    role: "finance",
    scope: { type: "global" },
  });
  await world.seed.authenticator(account);
  const finance = world.as(
    await world.signedIn(account, { secondFactor: true })
  );
  const bytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
  const upload = await finance.requestOfflineDonationProofUpload({
    contentType: "application/pdf",
    sizeBytes: bytes.length,
  });
  if (!upload.ok) throw new Error(upload.error);
  expect(
    await world.storage.put(upload.uploadUrl, bytes, upload.headers)
  ).toMatchObject({ ok: true });
  expect(await finance.completeUpload({ fileId: upload.fileId })).toMatchObject(
    { ok: true }
  );
  const input = {
    donorType: "individual",
    name: "Race donor",
    email: world.uniqueEmail(),
    amountMinor: 50_000n,
    method: "cash",
    reference: "FOA/RACE",
    receivedOn: istDate(world.clock.now()),
    proofFileId: upload.fileId,
    declaredAdult: true,
    declaredIndianSource: true,
  } as const;
  const results = await Promise.all([
    finance.recordOfflineDonation(input),
    finance.recordOfflineDonation(input),
  ]);
  const accepted = results.filter((result) => result.ok);
  expect(accepted).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual([
    { ok: false, error: "proof_already_used" },
  ]);
  if (!accepted[0]?.ok) throw new Error("No recorded donation");
  await world.drain();
  const detail = await finance.getDonation({
    donationId: accepted[0].donationId,
  });
  expect(detail).toMatchObject({
    ok: true,
    donation: { receiptNumber: accepted[0].receiptNumber },
  });
  const rows =
    await world.sql`select count(*)::int as count from ledger_posting where source_type = 'donation' and source_id = ${accepted[0].donationId}`;
  expect(rows[0]?.count).toBe(1);
});
