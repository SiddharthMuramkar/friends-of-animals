import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestDb } from "./db";

describe("createTestDb", () => {
  it("applies the migrations, including pg_trgm", async () => {
    const db = await createTestDb();

    const extensions = await db.execute<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'pg_trgm'`
    );
    expect(extensions.rows).toEqual([{ extname: "pg_trgm" }]);

    const result = await db.execute<{ score: number }>(
      sql`select similarity('cat', 'cats') as score`
    );
    expect(result.rows[0]?.score).toBeGreaterThan(0);
  });

  it("gives every call its own database", async () => {
    const first = await createTestDb();
    const second = await createTestDb();

    await first.execute(sql`create table scratch (id int)`);

    const tables = await second.execute<{ count: number }>(
      sql`select count(*)::int as count from pg_tables where tablename = 'scratch'`
    );
    expect(tables.rows[0]?.count).toBe(0);
  });
});
