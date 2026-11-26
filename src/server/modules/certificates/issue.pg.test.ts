import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { certificate, outbox, resultRelease } from "../../db/schema";
import { SEED_RESULTS } from "../../seed/results";
let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => world.close());
const worker = { kind: "system", process: "worker" } as const;
it("concurrent release deliveries issue once and concurrent PDF jobs store once", async () => {
  await world.seed.preview();
  const [release] = await world.db
    .select()
    .from(resultRelease)
    .where(eq(resultRelease.id, SEED_RESULTS.releaseId));
  if (!release?.publishedAt) throw Error("missing release");
  // Fixture: committed release before its certificate delivery has been consumed.
  const prior = await world.db
    .delete(certificate)
    .where(eq(certificate.sourceReleaseId, release.id))
    .returning();
  for (const c of prior)
    await world.db
      .delete(outbox)
      .where(
        and(
          eq(outbox.aggregateId, c.id),
          eq(outbox.eventType, "certificate.render")
        )
      );
  const input = {
    competitionId: release.competitionId,
    releaseId: release.id,
    publishedAt: release.publishedAt.toISOString(),
  };
  const api = world.as(worker);
  const calls = await world.sql.begin(async (blocker) => {
    await blocker`select id from competition where id=${input.competitionId} for update`;
    const a = api.issueCertificates(input);
    a.catch(() => {});
    await world.waitForLockWaiters(1);
    const b = api.issueCertificates(input);
    b.catch(() => {});
    await world.waitForLockWaiters(2);
    return { a, b };
  });
  expect(await Promise.all([calls.a, calls.b])).toEqual(
    expect.arrayContaining([{ issued: 16 }, { issued: 0 }])
  );
  const rows = await world.db
    .select()
    .from(certificate)
    .where(eq(certificate.sourceReleaseId, release.id));
  expect(rows).toHaveLength(16);
  expect(new Set(rows.map((x) => x.number)).size).toBe(16);
  const id = rows[0]!.id;
  const renders = await world.sql.begin(async (blocker) => {
    await blocker`select id from competition where id=${release.competitionId} for update`;
    const a = api.renderCertificate({ certificateId: id });
    a.catch(() => {});
    await world.waitForLockWaiters(1);
    const b = api.renderCertificate({ certificateId: id });
    b.catch(() => {});
    await world.waitForLockWaiters(2);
    return { a, b };
  });
  await Promise.all([renders.a, renders.b]);
  expect(world.pdf.rendered).toHaveLength(1);
  const [rendered] = await world.db
    .select()
    .from(certificate)
    .where(eq(certificate.id, id));
  expect(rendered).toMatchObject({ renderStatus: "rendered", pdfFileId: id });
});
