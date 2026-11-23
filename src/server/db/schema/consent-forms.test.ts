import { sql } from "drizzle-orm";
import { expect, it } from "vitest";

import { createTestDb } from "@/test/db";

it("indexes the student and competition foreign keys for every signed-form status", async () => {
  const db = await createTestDb();
  const { rows } = await db.execute<{ column_name: string }>(sql`
    SELECT attr.attname AS column_name
    FROM pg_index idx
    JOIN pg_attribute attr ON attr.attrelid = idx.indrelid AND attr.attnum = idx.indkey[0]
    WHERE idx.indrelid = 'consent_form'::regclass
      AND idx.indpred IS NULL AND idx.indisvalid
  `);
  expect(rows.map(({ column_name }) => column_name)).toEqual(
    expect.arrayContaining(["participant_profile_id", "competition_id"])
  );
});
