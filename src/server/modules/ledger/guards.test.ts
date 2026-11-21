// The ledger's database guards (#105): the chart every database starts
// with, and the rules Postgres enforces on its own, whatever code writes.
// Raw SQL on purpose: these must hold even for a writer that skips
// postToLedger.

import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { sqlState } from "@/server/errors";
import { createTestDb, type TestDb } from "@/test/db";

import { SEEDED_ACCOUNTS } from "./domain/chart";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  return () => db.$client.close();
});

type RawLine = {
  code: string;
  debit: bigint;
  credit: bigint;
  currency?: string;
};

let postings = 0;

/** A posting id unique within the test file. */
function nextPostingId(): string {
  postings += 1;
  return `01938a00-0000-7000-9000-${String(postings).padStart(12, "0")}`;
}

async function insertPosting(
  writer: Pick<TestDb, "execute">,
  id: string,
  lines: readonly RawLine[]
): Promise<void> {
  await writer.execute(sql`
    INSERT INTO ledger_posting
      (id, source_type, source_id, occurred_at, period_month, description, created_at)
    VALUES
      (${id}, 'manual', ${id}, '2027-01-15T04:30:00Z', '2027-01', 'Raw test posting', '2027-01-15T04:30:00Z')
  `);
  for (const [index, line] of lines.entries()) {
    await insertLine(writer, id, index + 1, line);
  }
}

async function insertLine(
  writer: Pick<TestDb, "execute">,
  postingId: string,
  lineNo: number,
  line: RawLine
): Promise<void> {
  await writer.execute(sql`
    INSERT INTO ledger_line
      (id, posting_id, line_no, account_id, debit_minor, credit_minor, currency)
    VALUES (
      gen_random_uuid(), ${postingId}, ${lineNo},
      (SELECT id FROM ledger_account WHERE code = ${line.code}),
      ${line.debit}, ${line.credit}, ${line.currency ?? "INR"}
    )
  `);
}

/** Inserts a posting and its lines in one transaction. */
async function commitPosting(lines: readonly RawLine[]): Promise<string> {
  const id = nextPostingId();
  await db.transaction((tx) => insertPosting(tx, id, lines));
  return id;
}

const BALANCED: readonly RawLine[] = [
  { code: "1000", debit: 10_000n, credit: 0n },
  { code: "4100", debit: 0n, credit: 10_000n },
];

/** What a rejected promise threw: its SQLSTATE and every message in the chain. */
async function rejection(
  promise: Promise<unknown>
): Promise<{ code: string | undefined; message: string }> {
  try {
    await promise;
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    return { code: sqlState(error), message: messages.join(" / ") };
  }
  throw new Error("Expected the statement to be refused, but it succeeded");
}

async function count(table: "ledger_posting" | "ledger_line"): Promise<number> {
  const result = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`
  );
  return result.rows[0]!.n;
}

describe("the chart every database starts with", () => {
  it("holds exactly the seeded accounts, all active", async () => {
    const result = await db.execute<{
      code: string;
      name: string;
      kind: string;
      is_system: boolean;
      is_active: boolean;
      public_group: string | null;
    }>(sql`
      SELECT code, name, kind, is_system, is_active, public_group
      FROM ledger_account ORDER BY code
    `);

    expect(result.rows).toEqual(
      SEEDED_ACCOUNTS.map((account) => ({
        code: account.code,
        name: account.name,
        kind: account.kind,
        is_system: account.isSystem,
        is_active: true,
        public_group: account.publicGroup,
      }))
    );
  });
});

describe("a posting must balance when its transaction commits", () => {
  it("commits a balanced posting of two lines", async () => {
    await commitPosting(BALANCED);

    expect(await count("ledger_posting")).toBe(1);
    expect(await count("ledger_line")).toBe(2);
  });

  it("refuses debits of Rs 100 against credits of Rs 90 at COMMIT", async () => {
    let insertedEveryLine = false;
    const id = nextPostingId();

    const refused = await rejection(
      db.transaction(async (tx) => {
        await insertPosting(tx, id, [
          { code: "1000", debit: 10_000n, credit: 0n },
          { code: "4100", debit: 0n, credit: 9_000n },
        ]);
        insertedEveryLine = true;
      })
    );

    expect(insertedEveryLine).toBe(true);
    expect(refused.code).toBe("23514");
    expect(refused.message).toMatch(/unbalanced/);
    expect(await count("ledger_posting")).toBe(0);
    expect(await count("ledger_line")).toBe(0);
  });

  it("refuses a posting with a single line at COMMIT", async () => {
    const id = nextPostingId();

    const refused = await rejection(
      db.transaction((tx) =>
        insertPosting(tx, id, [{ code: "1000", debit: 10_000n, credit: 0n }])
      )
    );

    expect(refused.code).toBe("23514");
    expect(refused.message).toMatch(/at least 2 lines/);
    expect(await count("ledger_posting")).toBe(0);
  });

  it("refuses a posting with no lines at COMMIT", async () => {
    const id = nextPostingId();

    const refused = await rejection(
      db.transaction((tx) => insertPosting(tx, id, []))
    );

    expect(refused.code).toBe("23514");
    expect(refused.message).toMatch(/at least 2 lines/);
    expect(await count("ledger_posting")).toBe(0);
  });

  it("refuses a line added later that unbalances a committed posting", async () => {
    const id = await commitPosting(BALANCED);

    const refused = await rejection(
      db.transaction((tx) =>
        insertLine(tx, id, 3, { code: "1010", debit: 500n, credit: 0n })
      )
    );

    expect(refused.message).toMatch(/unbalanced/);
    expect(await count("ledger_line")).toBe(2);
  });
});

describe("postings and lines are append-only", () => {
  it.each([
    ["UPDATE ledger_posting", sql`UPDATE ledger_posting SET description = 'Edited'`],
    ["DELETE FROM ledger_posting", sql`DELETE FROM ledger_posting`],
    ["UPDATE ledger_line", sql`UPDATE ledger_line SET debit_minor = debit_minor`],
    ["DELETE FROM ledger_line", sql`DELETE FROM ledger_line`],
    ["TRUNCATE ledger_line", sql`TRUNCATE ledger_line`],
    ["TRUNCATE ledger_posting, ledger_line", sql`TRUNCATE ledger_posting, ledger_line`],
  ])("refuses %s", async (_statement, statement) => {
    await commitPosting(BALANCED);

    const refused = await rejection(db.execute(statement));

    expect(refused.code).toBe("42501");
    expect(refused.message).toMatch(/append-only/);
    expect(await count("ledger_posting")).toBe(1);
    expect(await count("ledger_line")).toBe(2);
  });
});

describe("each line moves money on exactly one side, in rupees", () => {
  it.each([
    ["both sides set", { code: "1000", debit: 100n, credit: 100n }],
    ["neither side set", { code: "1000", debit: 0n, credit: 0n }],
    ["a negative debit", { code: "1000", debit: -100n, credit: 0n }],
  ])("refuses a line with %s", async (_case, line) => {
    const id = nextPostingId();

    const refused = await rejection(
      db.transaction((tx) => insertPosting(tx, id, [line, line]))
    );

    expect(refused.code).toBe("23514");
    expect(refused.message).toMatch(/ledger_line_one_side/);
  });

  it("refuses a line in a currency other than INR", async () => {
    const id = nextPostingId();

    const refused = await rejection(
      db.transaction((tx) =>
        insertPosting(tx, id, [
          { code: "1000", debit: 100n, credit: 0n, currency: "USD" },
          { code: "4100", debit: 0n, credit: 100n, currency: "USD" },
        ])
      )
    );

    expect(refused.code).toBe("23514");
    expect(refused.message).toMatch(/ledger_line_currency_inr/);
  });
});
