import { randomInt } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { certificate, registration } from "../../db/schema";
import { insertCertificate } from "../certificates/issue";
import { adultForm, openToIndividuals } from "../participants/testing";
import { renderStamp } from ".";

let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => world.close());

it("serializes simultaneous certificate share requests and duplicate media deliveries", async () => {
  // PG test files share a real database, but each world has its own fake
  // object storage. An earlier test may already have rendered a seeded PDF
  // into another world's storage. Give this race a new, independently owned
  // registration and certificate via the same issuance helper instead.
  const code = `${Array.from({ length: 6 }, () => String.fromCharCode(65 + randomInt(26))).join("")}27`;
  const competition = await openToIndividuals(world, {
    code,
    name: `Certificate share race ${code}`,
    fee: 0n,
  });
  const owner = await world.signedIn(
    await world.seed.member({ email: world.uniqueEmail() })
  );
  const api = world.as(owner);
  const registered = await api.registerAsIndividual(adultForm(competition));
  if (!registered.ok) throw Error(registered.error);
  expect(
    await api.payForMyRegistration({
      registrationId: registered.registrationId,
    })
  ).toMatchObject({ ok: true });
  const [holder] = await world.db
    .select({ profileId: registration.participantProfileId })
    .from(registration)
    .where(eq(registration.id, registered.registrationId));
  const issued = await insertCertificate(world.db, world.clock, {
    type: "participation",
    competitionId: competition.id,
    registrationId: registered.registrationId,
    participantProfileId: holder!.profileId,
    nameSnapshot: adultForm(competition).fullName!,
  });
  const certificateId = issued.id;
  expect(await api.listMyCertificates()).toMatchObject([
    { id: certificateId, renderStatus: "pending" },
  ]);
  const input = { certificateId };
  await world
    .as({ kind: "system", process: "worker" })
    .renderCertificate(input);
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
