import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { certificate } from "../../db/schema";
import { SEED_ACCOUNTS } from "../../seed/accounts";
import { renderStamp } from ".";

let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => world.close());

it("serializes simultaneous certificate share requests and duplicate media deliveries", async () => {
  await world.seed.preview();
  const owner = await world.signedIn(
    await world.seed.member({ email: SEED_ACCOUNTS.members[0]!.email })
  );
  const [mine] = await world.as(owner).listMyCertificates();
  const certificateId = mine!.id;
  const input = { certificateId };
  await world
    .as({ kind: "system", process: "worker" })
    .renderCertificate(input);
  const api = world.as(owner);
  const requests = await world.sql.begin(async (blocker) => {
    await blocker`select id from certificate where id=${certificateId} for update`;
    const a = api.requestCertificateShare(input);
    a.catch(() => {});
    await world.waitForLockWaiters(1);
    const b = api.requestCertificateShare(input);
    b.catch(() => {});
    await world.waitForLockWaiters(2);
    return { a, b };
  });
  expect(await Promise.all([requests.a, requests.b])).toEqual([
    { ok: true, status: "queued" },
    { ok: true, status: "queued" },
  ]);
  const [row] = await world.db
    .select()
    .from(certificate)
    .where(eq(certificate.id, certificateId));
  const stamp = {
    fileId: row!.pdfFileId!,
    variant: "certificate_share" as const,
  };
  const jobs = await world.sql.begin(async (blocker) => {
    await blocker`select id from file_asset where id=${stamp.fileId} for update`;
    const a = renderStamp(world.deps, stamp);
    a.catch(() => {});
    await world.waitForLockWaiters(1);
    const b = renderStamp(world.deps, stamp);
    b.catch(() => {});
    await world.waitForLockWaiters(2);
    return { a, b };
  });
  await Promise.all([jobs.a, jobs.b]);
  expect(world.media.stamps).toHaveLength(1);
  const share = await api.getCertificateShareUrl(input);
  if (!share.ok) throw Error(share.error);
  expect(await world.storage.get(share.url)).toMatchObject({
    ok: true,
    contentType: "image/png",
  });
});
