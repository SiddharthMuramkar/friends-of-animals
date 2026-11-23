import { ensureVerifiedAccount } from "../identity/verified-account";
import { insertLedgerAccount } from "../modules/ledger/accounts";
import { backfillLedgerFromPayments } from "../modules/ledger/backfill";
import { istDateOf, parseIstDate } from "../modules/ledger/domain/period";
import { postToLedger } from "../modules/ledger/post";
import { ensureGrant } from "./access";
import { ensureSeedAuthenticator } from "./second-factor";
import type { Seeder } from "./types";

const FINANCE = {
  name: "Ledger Finance",
  email: "ledger-finance@example.test",
};
const ENTRIES = [
  {
    id: "01938a00-0000-7000-8000-000000105021",
    description: "Community hall hire",
    lines: [
      { accountCode: "5110", side: "debit", amountMinor: 125_000n },
      { accountCode: "1000", side: "credit", amountMinor: 125_000n },
    ],
  },
  {
    id: "01938a00-0000-7000-8000-000000105022",
    description: "Petty cash deposit",
    lines: [
      { accountCode: "1010", side: "debit", amountMinor: 40_000n },
      { accountCode: "1000", side: "credit", amountMinor: 40_000n },
    ],
  },
] as const;

/** The paid and refunded sample batches, plus a category and two manual entries. */
export const seedLedger: Seeder = async (deps) => {
  const { db, clock } = deps;
  const ctx = {
    db,
    clock,
    actor: { kind: "system", process: "seed" },
  } as const;
  await backfillLedgerFromPayments(ctx);
  const finance = await ensureVerifiedAccount(deps, FINANCE);
  await ensureGrant(deps, finance.id, {
    role: "finance",
    scope: { type: "global" },
  });
  await ensureSeedAuthenticator(deps, finance.id);

  const day = parseIstDate(istDateOf(clock.now()));
  if (!day.ok)
    throw new Error("The ledger seed clock did not give a valid date");
  await db.transaction(async (tx) => {
    await insertLedgerAccount(
      tx,
      ctx,
      {
        code: "5110",
        kind: "expense",
        name: "Venue hire",
        publicGroup: "programs",
      },
      null
    );
    for (const entry of ENTRIES) {
      await postToLedger(tx, ctx, {
        source: { type: "manual", id: entry.id },
        occurredAt: day.start,
        description: entry.description,
        lines: entry.lines,
      });
    }
  });
};
