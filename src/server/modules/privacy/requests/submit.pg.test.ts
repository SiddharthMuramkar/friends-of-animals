// #115a on real Postgres: two filings about the same child, by its two
// guardians at once, queue on the child's lock, so one files and the other
// is told a request of that type is already open.

import { afterAll, beforeAll, expect, it } from "vitest";

import { guardianLink } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { createPgWorld, type PgWorld } from "@/test/pg";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

it("files one open request per type about a child, however the guardians race", async () => {
  const family = await world.seed.guardian({
    email: world.uniqueEmail(),
    children: [{ fullName: "Ira Rao", age: 9 }],
  });
  const childId = family.childIds[0]!;
  const second = await world.seed.guardian({
    email: world.uniqueEmail(),
    children: [],
  });
  await world.db.insert(guardianLink).values({
    id: uuidv7(world.clock.now()),
    guardianId: second.guardianId,
    participantProfileId: childId,
    relationship: "parent",
    createdAt: world.clock.now(),
  });
  const mother = world.as(await world.signedIn(family.account));
  const father = world.as(await world.signedIn(second.account));
  const filing = {
    type: "access",
    subject: { kind: "child", childId },
  } as const;

  let both: ReturnType<typeof mother.submitPrivacyRequest>[] = [];
  await world.sql.begin(async (sql) => {
    // Hold the child's lock so both filings start and wait on it.
    await sql`SELECT pg_advisory_xact_lock(115, hashtext(${childId}))`;
    both = [
      mother.submitPrivacyRequest(filing),
      father.submitPrivacyRequest(filing),
    ];
    await world.waitForLockWaiters(2);
  });
  const results = await Promise.all(both);

  const filed = results.filter((result) => result.ok);
  expect(filed).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual([
    {
      ok: false,
      error: "already_open",
      reference: (filed[0] as { reference: string }).reference,
    },
  ]);
});
