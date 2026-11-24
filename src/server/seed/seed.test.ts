import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { fieldCryptoFor } from "@/server/crypto/keys";
import { user } from "@/server/db/schema";
import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";

import { SEED_ACCOUNTS } from "./accounts";
import { createSeedBuilders, seedPreview } from "./index";

async function seedDeps() {
  return {
    db: await createTestDb(),
    clock: new FakeClock(),
    ...fieldCryptoFor({ APP_ENV: "local" }),
    auth: { secret: "seed-test-secret-0123456789abcdef" },
  };
}

async function accounts(deps: Awaited<ReturnType<typeof seedDeps>>) {
  return deps.db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .orderBy(asc(user.email));
}

describe("seedPreview", () => {
  it("creates the preview accounts, including the dedicated Ledger Finance user", async () => {
    const deps = await seedDeps();
    await seedPreview(deps);

    expect((await accounts(deps)).map((account) => account.email)).toEqual([
      "community-manager@example.test",
      "competition-manager-2@example.test",
      "competition-manager@example.test",
      "consent-publisher-desktop@example.test",
      "consent-publisher-mobile@example.test",
      "dsl@example.test",
      "guardian1@example.test",
      "institution-admin@example.test",
      "institution-applicant@example.test",
      "ledger-finance@example.test",
      "member1@example.test",
      "member2@example.test",
      "member3@example.test",
      "super-admin@example.test",
      "teen1@example.test",
      "teen2@example.test",
      "template-editor-desktop@example.test",
      "template-editor-mobile@example.test",
      "volunteer1@example.test",
      "volunteer2@example.test",
    ]);
  });

  it("changes nothing when it runs again", async () => {
    const deps = await seedDeps();
    await seedPreview(deps);
    const first = await accounts(deps);

    deps.clock.advance({ days: 1 });
    await seedPreview(deps);

    expect(await accounts(deps)).toEqual(first);
  });

  it("keeps an account that already uses a seeded address", async () => {
    const deps = await seedDeps();
    const builders = createSeedBuilders(deps);
    const existing = await builders.member({
      email: SEED_ACCOUNTS.members[0].email,
    });

    await seedPreview(deps);

    const [account] = (await accounts(deps)).filter(
      ({ email }) => email === "member1@example.test"
    );
    expect(account?.id).toBe(existing.id);
  });
});

describe("createSeedBuilders", () => {
  it("makes a different member every time", async () => {
    const builders = createSeedBuilders(await seedDeps());

    const first = await builders.member();
    const second = await builders.member();

    expect(first.id).not.toBe(second.id);
    expect(first.email).not.toBe(second.email);
    expect(first.email).toMatch(/@example\.test$/);
  });

  it("lets a test choose a member's details", async () => {
    const builders = createSeedBuilders(await seedDeps());

    const member = await builders.member({
      name: "Kavya Nair",
      email: " Kavya@Example.test ",
    });

    expect(member).toMatchObject({
      name: "Kavya Nair",
      email: "kavya@example.test",
    });
  });

  it("stamps accounts with the clock's time", async () => {
    const deps = await seedDeps();
    const member = await createSeedBuilders(deps).member();

    expect(member.createdAt).toEqual(deps.clock.now());
  });
});
