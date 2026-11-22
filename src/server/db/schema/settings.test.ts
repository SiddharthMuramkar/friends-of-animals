import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestDb } from "@/test/db";

describe("setting", () => {
  // Spec 10.9: foreign key columns are indexed, like every other one in
  // the schema, so deleting a user (which clears their name from the
  // settings they changed) doesn't scan the whole table.
  it("indexes the column of each of its foreign keys", async () => {
    const db = await createTestDb();

    const unindexed = await db.execute<{ name: string }>(sql`
      select c.conname as name
      from pg_constraint c
      where c.contype = 'f'
        and c.conrelid = 'setting'::regclass
        and not exists (
          select 1
          from pg_index i
          where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
        )
    `);
    expect(unindexed.rows).toEqual([]);
  });
});
