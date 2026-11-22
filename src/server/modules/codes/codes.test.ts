import { describe, expect, it } from "vitest";

import {
  generateCode,
  INSTITUTION_CODE,
  UniqueCodeExhaustedError,
  withUniqueCode,
} from "./codes";

/** Hands out the given bytes in order, as many as each call asks for. */
function bytesFrom(values: readonly number[]) {
  let next = 0;
  return (length: number) =>
    Uint8Array.from({ length }, () => values[next++ % values.length]!);
}

describe("generateCode", () => {
  it("makes Institution IDs as FOA-I- plus 5 Crockford base32 characters", () => {
    for (let draw = 0; draw < 200; draw++) {
      expect(generateCode(INSTITUTION_CODE)).toMatch(
        /^FOA-I-[0-9A-HJKMNP-TV-Z]{5}$/
      );
    }
  });

  it("spells the random bytes in Crockford base32", () => {
    expect(generateCode(INSTITUTION_CODE, bytesFrom([8, 17, 3, 26, 31]))).toBe(
      "FOA-I-8H3TZ"
    );
  });
});

describe("the code alphabet", () => {
  it("uses 32 symbols, never I, L, O or U, each as likely as the others", () => {
    const allBytes = Array.from({ length: 256 }, (_, byte) => byte);
    const format = { prefix: "", length: 256 };
    const symbols = generateCode(format, bytesFrom(allBytes));

    const counts = new Map<string, number>();
    for (const symbol of symbols) {
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    expect([...counts.keys()].sort().join("")).toBe(
      "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    );
    expect(new Set(counts.values())).toEqual(new Set([8]));
  });
});

/** What Postgres reports for a duplicate key: SQLSTATE 23505. */
function uniqueViolation(constraint: string) {
  return Object.assign(new Error("duplicate key value"), {
    code: "23505",
    constraint,
  });
}

const CONSTRAINT = "institution_institution_code_unique";

describe("withUniqueCode", () => {
  it("passes a fresh code to the attempt and returns its result", async () => {
    const tried: string[] = [];
    const result = await withUniqueCode(
      {
        format: INSTITUTION_CODE,
        constraint: CONSTRAINT,
        random: bytesFrom([8, 17, 3, 26, 31]),
      },
      async (code) => {
        tried.push(code);
        return `saved ${code}`;
      }
    );
    expect(result).toBe("saved FOA-I-8H3TZ");
    expect(tried).toEqual(["FOA-I-8H3TZ"]);
  });

  it("draws a new code when the first one is already taken", async () => {
    const taken = new Set(["FOA-I-8H3TZ"]);
    const tried: string[] = [];
    const code = await withUniqueCode(
      {
        format: INSTITUTION_CODE,
        constraint: CONSTRAINT,
        // The first draw repeats a code that exists, the second is new.
        random: bytesFrom([8, 17, 3, 26, 31, 1, 2, 3, 4, 5]),
      },
      async (candidate) => {
        tried.push(candidate);
        if (taken.has(candidate)) throw uniqueViolation(CONSTRAINT);
        return candidate;
      }
    );
    expect(tried).toEqual(["FOA-I-8H3TZ", "FOA-I-12345"]);
    expect(code).toBe("FOA-I-12345");
  });

  it("gives up after the last attempt collides", async () => {
    let attempts = 0;
    const always = withUniqueCode(
      {
        format: INSTITUTION_CODE,
        constraint: CONSTRAINT,
        random: bytesFrom([0]),
        maxAttempts: 3,
      },
      async () => {
        attempts += 1;
        throw uniqueViolation(CONSTRAINT);
      }
    );
    await expect(always).rejects.toThrow(UniqueCodeExhaustedError);
    expect(attempts).toBe(3);
  });

  it("tries five codes by default", async () => {
    let attempts = 0;
    await expect(
      withUniqueCode(
        { format: INSTITUTION_CODE, constraint: CONSTRAINT },
        async () => {
          attempts += 1;
          throw uniqueViolation(CONSTRAINT);
        }
      )
    ).rejects.toThrow(UniqueCodeExhaustedError);
    expect(attempts).toBe(5);
  });

  it("does not retry other failures", async () => {
    for (const failure of [
      uniqueViolation("institution_contact_email_unique"),
      Object.assign(new Error("null value"), { code: "23502" }),
      new Error("connection lost"),
    ]) {
      let attempts = 0;
      const attempt = withUniqueCode(
        { format: INSTITUTION_CODE, constraint: CONSTRAINT },
        async () => {
          attempts += 1;
          throw failure;
        }
      );
      await expect(attempt).rejects.toBe(failure);
      expect(attempts).toBe(1);
    }
  });
});
