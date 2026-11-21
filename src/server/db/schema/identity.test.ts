import { describe, expect, it } from "vitest";

import { uuidv7 } from "@/server/ids";
import { createTestDb } from "@/test/db";

import { user } from "./identity";

const now = new Date("2027-01-15T04:30:00Z");

function account(email: string) {
  return {
    id: uuidv7(now),
    name: "Asha",
    email,
    createdAt: now,
    updatedAt: now,
  };
}

/** The database's own message for a refused insert, or null if it went in. */
async function refusal(insert: PromiseLike<unknown>): Promise<string | null> {
  try {
    await insert;
    return null;
  } catch (error) {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
}

describe("user", () => {
  // Better Auth (57b) and later sign-in paths write this table without
  // FOA's normaliseEmailAddress, so the database itself keeps one account
  // per address.
  it("keeps one account per address, whatever the case or spacing", async () => {
    const db = await createTestDb();
    await db.insert(user).values(account("asha@example.test"));

    for (const email of [
      "Asha@Example.test",
      " asha@example.test",
      "asha@example.test ",
      "asha@example.test\t",
      "asha@example.test\n",
      "\u00a0asha@example.test",
      "asha@example.test\u2003",
      "\ufeffasha@example.test",
      "asha@exam\u0007ple.test",
    ]) {
      expect(await refusal(db.insert(user).values(account(email)))).toEqual(
        expect.stringMatching(/user_email_normalised/)
      );
    }
    expect(await db.$count(user)).toBe(1);
  });

  it("takes an address that is already trimmed and lower-cased", async () => {
    const db = await createTestDb();

    expect(
      await refusal(db.insert(user).values(account("ravi.k+foa@example.test")))
    ).toBeNull();
  });
});
