import { describe, expect, it, vi } from "vitest";

import {
  createPreviewDatabase,
  quoteIdentifier,
  quoteLiteral,
} from "./preview-database";

const PR = { name: "foa_pr_7", comment: "foa-preview pr=7" };

/** An error as postgres.js throws it: a PostgresError with a SQLSTATE. */
function postgresError(code: string) {
  return Object.assign(new Error(`SQLSTATE ${code}`), { code });
}

/** Fake `run` that answers CREATE DATABASE with `outcomes` in turn. */
function fakeSql(...outcomes: (string | undefined)[]) {
  const queries: string[] = [];
  const run = vi.fn(async (query: string) => {
    queries.push(query);
    if (query.startsWith("CREATE DATABASE")) {
      const code = outcomes.shift();
      if (code !== undefined) throw postgresError(code);
    }
  });
  return { run, queries };
}

const quiet = { log: () => {}, sleep: async () => {} };

describe("createPreviewDatabase", () => {
  it("creates the database from foa_seed and comments it", async () => {
    const { run, queries } = fakeSql(undefined);
    await expect(createPreviewDatabase(run, PR, quiet)).resolves.toBe(
      "created"
    );
    expect(queries).toEqual([
      'CREATE DATABASE "foa_pr_7" TEMPLATE "foa_seed"',
      `COMMENT ON DATABASE "foa_pr_7" IS 'foa-preview pr=7'`,
    ]);
  });

  it("treats an existing database as success and comments it again", async () => {
    for (const code of ["42P04", "23505"]) {
      const { run, queries } = fakeSql(code);
      await expect(createPreviewDatabase(run, PR, quiet)).resolves.toBe(
        "exists"
      );
      expect(queries.at(-1)).toMatch(/^COMMENT ON DATABASE "foa_pr_7"/);
    }
  });

  it("tries again with backoff while the template is in use", async () => {
    const { run } = fakeSql("55006", "55006", undefined);
    const sleep = vi.fn(async () => {});
    await expect(
      createPreviewDatabase(run, PR, { ...quiet, sleep })
    ).resolves.toBe("created");
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it("gives up once the attempts run out", async () => {
    const { run, queries } = fakeSql("55006", "55006", "55006");
    await expect(
      createPreviewDatabase(run, PR, { ...quiet, attempts: 3 })
    ).rejects.toMatchObject({ code: "55006" });
    expect(queries.filter((q) => q.startsWith("COMMENT"))).toEqual([]);
  });

  it("passes other errors on at once", async () => {
    const { run } = fakeSql("42501");
    await expect(createPreviewDatabase(run, PR, quiet)).rejects.toMatchObject({
      code: "42501",
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("quotes a branch's comment safely", async () => {
    const { run, queries } = fakeSql(undefined);
    await createPreviewDatabase(
      run,
      { name: "foa_br_it_s", comment: "foa-preview branch=it's" },
      quiet
    );
    expect(queries.at(-1)).toBe(
      `COMMENT ON DATABASE "foa_br_it_s" IS 'foa-preview branch=it''s'`
    );
  });
});

describe("quoting", () => {
  it("doubles the quote character", () => {
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
    expect(quoteLiteral("a'b\\c")).toBe("'a''b\\c'");
  });
});
