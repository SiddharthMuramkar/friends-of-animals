import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { INSTITUTION_CODE, withUniqueCode } from "./codes";

/** Hands out the given bytes in order, as many as each call asks for. */
function bytesFrom(values: readonly number[]) {
  let next = 0;
  return (length: number) =>
    Uint8Array.from({ length }, () => values[next++ % values.length]!);
}

// A real Postgres (PGlite) table with a unique code column, so the retry is
// proven against the error Drizzle and the driver actually raise.
const db = drizzle({ client: new PGlite() });

beforeAll(async () => {
  await db.execute(sql`
    create table coded (
      code text not null constraint coded_code_unique unique,
      note text not null constraint coded_note_unique unique
    )
  `);
  await db.execute(sql`insert into coded values ('FOA-I-8H3TZ', 'first')`);
});

async function codes() {
  const result = await db.execute<{ code: string }>(
    sql`select code from coded order by code`
  );
  return result.rows.map((row) => row.code);
}

describe("withUniqueCode against Postgres", () => {
  it("retries a taken code inside a transaction through a savepoint", async () => {
    const stored = await db.transaction((tx) =>
      withUniqueCode(
        {
          format: INSTITUTION_CODE,
          constraint: "coded_code_unique",
          random: bytesFrom([8, 17, 3, 26, 31, 1, 2, 3, 4, 5]),
        },
        (code) =>
          tx.transaction(async (savepoint) => {
            await savepoint.execute(
              sql`insert into coded values (${code}, 'second')`
            );
            return code;
          })
      )
    );
    expect(stored).toBe("FOA-I-12345");
    expect(await codes()).toEqual(["FOA-I-12345", "FOA-I-8H3TZ"]);
  });

  it("rethrows a duplicate on another unique column", async () => {
    let attempts = 0;
    await expect(
      withUniqueCode(
        { format: INSTITUTION_CODE, constraint: "coded_code_unique" },
        async (code) => {
          attempts += 1;
          await db.execute(sql`insert into coded values (${code}, 'first')`);
        }
      )
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});
