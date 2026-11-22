import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createBlindIndex,
  type BlindIndexKey,
} from "@/server/crypto/blind-index";
import { createFieldCipher } from "@/server/crypto/field-cipher";
import { createTestDb, type TestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";

import { SEED_ACCOUNTS } from "./accounts";
import { createSeedBuilders, seedPreview } from "./index";

// Phone numbers are personal data: the user table keeps them encrypted
// (phone_ciphertext) and finds them through a keyed hash (phone_hash).
// These tests read the table raw, as a leaked backup or a stray query would.

const MEMBER1_PHONE = "+919000000101";

type Row = Record<string, unknown>;

async function seedDeps() {
  const key1 = randomBytes(32);
  return {
    db: await createTestDb(),
    clock: new FakeClock(),
    cipher: createFieldCipher({ primary: 1, keys: new Map([[1, key1]]) }),
    blindIndex: createBlindIndex(randomBytes(32) as BlindIndexKey),
    auth: { secret: "seed-test-secret-0123456789abcdef" },
    key1,
  };
}

async function userRows(db: TestDb): Promise<Row[]> {
  const { rows } = await db.$client.query<Row>(
    'select * from "user" order by created_at, id'
  );
  return rows;
}

describe("the preview seed's phone", () => {
  it("gives member1, Asha Rao, the phone +91 90000 00101, once", async () => {
    const deps = await seedDeps();
    await seedPreview(deps);
    deps.clock.advance({ days: 1 });
    await seedPreview(deps);

    const rows = await userRows(deps.db);
    const withPhone = rows.filter((row) => row.phone_hash !== null);
    expect(withPhone).toHaveLength(1);
    const [member1] = withPhone;
    expect(member1).toMatchObject({
      id: SEED_ACCOUNTS.members[0].id,
      name: "Asha Rao",
      email: "member1@example.test",
      phone_hash: deps.blindIndex.of("user.phone", MEMBER1_PHONE),
      phone_verified: true,
    });
    expect(
      deps.cipher.decrypt("user.phone", String(member1?.phone_ciphertext))
    ).toBe(MEMBER1_PHONE);
  });

  it("never shows the number to a raw query", async () => {
    const deps = await seedDeps();
    await seedPreview(deps);

    const everything = JSON.stringify(await userRows(deps.db));
    expect(everything).toContain("phone_ciphertext");
    expect(everything).not.toContain("9000000101");
    expect(everything).not.toContain("90000 00101");
  });

  it("still reads a phone stored under key 1 after key 2 is added", async () => {
    const deps = await seedDeps();
    await seedPreview(deps);
    const rotated = createFieldCipher({
      primary: 2,
      keys: new Map([
        [1, deps.key1],
        [2, randomBytes(32)],
      ]),
    });

    const [member1] = (await userRows(deps.db)).filter(
      (row) => row.phone_hash !== null
    );
    const stored = String(member1?.phone_ciphertext);
    expect(stored).toMatch(/^v1:/);
    expect(rotated.decrypt("user.phone", stored)).toBe(MEMBER1_PHONE);
    expect(rotated.encrypt("user.phone", MEMBER1_PHONE)).toMatch(/^v2:/);
  });

  it("leaves member1 without a phone that another account already holds", async () => {
    const deps = await seedDeps();
    const other = await createSeedBuilders(deps).member({
      email: "already-here@example.test",
      phone: "+91 90000 00101",
    });

    await seedPreview(deps);

    const rows = await userRows(deps.db);
    const member1 = rows.find((row) => row.id === SEED_ACCOUNTS.members[0].id);
    expect(member1).toMatchObject({ phone_hash: null, phone_ciphertext: null });
    expect(rows.find((row) => row.id === other.id)).toMatchObject({
      phone_hash: deps.blindIndex.of("user.phone", MEMBER1_PHONE),
    });
  });
});

describe("createSeedBuilders: member with a phone", () => {
  it("stores the number encrypted, found by its canonical form", async () => {
    const deps = await seedDeps();

    const member = await createSeedBuilders(deps).member({
      phone: "098765 43210",
    });

    const [row] = (await userRows(deps.db)).filter(
      (candidate) => candidate.id === member.id
    );
    expect(row).toMatchObject({
      phone_hash: deps.blindIndex.of("user.phone", "+919876543210"),
      phone_verified: true,
    });
    expect(JSON.stringify(row)).not.toContain("9876543210");
    expect(
      deps.cipher.decrypt("user.phone", String(row?.phone_ciphertext))
    ).toBe("+919876543210");
  });

  it("refuses a number that isn't an Indian mobile", async () => {
    const builders = createSeedBuilders(await seedDeps());

    await expect(builders.member({ phone: "022 2345 6789" })).rejects.toThrow(
      /not an Indian mobile number/
    );
  });
});
