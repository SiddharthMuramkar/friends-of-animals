import { eq } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";

import { entry, entryFile } from "@/server/db/schema";
import {
  adultForm,
  openToIndividuals,
} from "@/server/modules/participants/testing";
import { createPgWorld, type PgWorld } from "@/test/pg";

import { ENTRY_TEXT } from "../testing";

// #86: two typed essays for one registration at once (two tabs, a double
// click) on separate connections. The registration lock serializes them:
// the first creates the entry, submitted; the second replaces its essay.
// One entry, one live essay, one receipt.

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

async function confirmedEssayist() {
  const letters = Array.from({ length: 6 }, () =>
    String.fromCharCode(65 + randomInt(26))
  ).join("");
  const code = `${letters}27`;
  const competition = await openToIndividuals(world, {
    code,
    name: `Essay race ${code}`,
    fee: 0n,
    disciplines: ["essay"],
  });
  const account = await world.seed.member({ email: world.uniqueEmail() });
  const actor = await world.signedIn(account);
  const app = world.as(actor);
  const registered = await app.registerAsIndividual(adultForm(competition));
  if (!registered.ok) throw new Error(registered.error);
  const paid = await app.payForMyRegistration({
    registrationId: registered.registrationId,
  });
  if (!paid.ok) throw new Error(paid.error);
  return { actor, registrationId: registered.registrationId };
}

it("makes one entry with one live essay from two simultaneous typed essays", async () => {
  const { actor, registrationId } = await confirmedEssayist();
  const submit = (essay: string) =>
    world.as(actor).submitEssayText({
      registrationId,
      discipline: "essay",
      ...ENTRY_TEXT,
      essay,
    });
  const blocker = await world.sql.reserve();
  let results: Awaited<ReturnType<typeof submit>>[] = [];
  try {
    await blocker`begin`;
    await blocker`select id from registration where id = ${registrationId} for update`;
    const both = Promise.all([submit("First tab."), submit("Second tab.")]);
    try {
      await world.waitForLockWaiters(2);
    } finally {
      await blocker`rollback`;
    }
    results = await both;
  } finally {
    blocker.release();
  }

  expect(results).toEqual([
    { ok: true, entryCode: expect.any(String), status: "submitted" },
    { ok: true, entryCode: expect.any(String), status: "submitted" },
  ]);
  expect(results[0]!.ok && results[1]!.ok).toBe(true);
  const entries = await world.db
    .select({ id: entry.id, code: entry.code, status: entry.status })
    .from(entry)
    .where(eq(entry.registrationId, registrationId));
  expect(entries).toHaveLength(1);
  const files = await world.db
    .select({ status: entryFile.status, kind: entryFile.kind })
    .from(entryFile)
    .where(eq(entryFile.entryId, entries[0]!.id));
  expect(files.map((file) => file.status).toSorted()).toEqual([
    "live",
    "superseded",
  ]);
});
