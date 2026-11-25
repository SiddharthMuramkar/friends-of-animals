// Ledger periods and two-approver seed data (#109), so a preview shows a
// locked month, the approvals queue and two finance users who can approve
// each other's requests. Loads under plain Node (the seed script):
// relative imports only, no "server-only".
//
// The months are fixed, not relative to the seed's clock: the previous
// financial year ends with March 2026 locked, and April 2026 waits for a
// second approver. Journeys post into later fixed months (#105's manual
// entry is dated 1 May 2026) and into the current month, so a lock here
// must never reach them.

import { eq } from "drizzle-orm";

import { financeApproval, ledgerPeriod } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { approvalExpiresAt } from "../modules/ledger/domain/approval";
import { istDateOf, parseIstDate } from "../modules/ledger/domain/period";
import { checkPeriodLock } from "../modules/ledger/domain/period-lock";
import { loadKnownPeriods } from "../modules/ledger/periods";
import { postToLedger } from "../modules/ledger/post";
import { ensureGrant } from "./access";
import { ensureSeedAuthenticator } from "./second-factor";
import type { Seeder } from "./types";

export const SEED_LEDGER_FINANCE = {
  name: "Ledger Finance",
  email: "ledger-finance@example.test",
};

/** The second finance user: approves what Ledger Finance asks for. */
export const SEED_LEDGER_APPROVER = {
  name: "Ledger Approver",
  email: "ledger-approver@example.test",
};

export const SEED_LOCKED_MONTH = "2026-03";
export const SEED_PENDING_LOCK_MONTH = "2026-04";

const IDS = {
  yearEndEntry: "01938a00-0000-7000-8000-000000109001",
  lockRequest: "01938a00-0000-7000-8000-000000109002",
  pendingLock: "01938a00-0000-7000-8000-000000109003",
  pendingEntry: "01938a00-0000-7000-8000-000000109004",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** A locked March 2026, a lock of April waiting, and a large entry waiting. */
export const seedLedgerPeriods: Seeder = async (deps) => {
  const { db, clock } = deps;
  const finance = await ensureVerifiedAccount(deps, SEED_LEDGER_FINANCE);
  const approver = await ensureVerifiedAccount(deps, SEED_LEDGER_APPROVER);
  for (const user of [finance, approver]) {
    await ensureGrant(deps, user.id, {
      role: "finance",
      scope: { type: "global" },
    });
    await ensureSeedAuthenticator(deps, user.id);
  }
  const now = clock.now();
  const seedCtx = {
    db,
    clock,
    actor: { kind: "system", process: "seed" },
  } as const;

  await db.transaction(async (tx) => {
    // Seeded once: a database with requests already keeps them as they are.
    // The pending lock is the marker because it is always written; the
    // approved lock is skipped when the month can't be locked.
    const [seeded] = await tx
      .select({ id: financeApproval.id })
      .from(financeApproval)
      .where(eq(financeApproval.id, IDS.pendingLock));
    if (seeded) return;

    const yearEnd = parseIstDate(`${SEED_LOCKED_MONTH}-31`);
    if (!yearEnd.ok) throw new Error("The seed's year-end date is invalid");
    await postToLedger(tx, seedCtx, {
      source: { type: "manual", id: IDS.yearEndEntry },
      occurredAt: yearEnd.start,
      description: "Year-end bank charges",
      lines: [
        { accountCode: "5900", side: "debit", amountMinor: 35_400n },
        { accountCode: "1000", side: "credit", amountMinor: 35_400n },
      ],
    });

    const periods = await loadKnownPeriods(tx);
    if (checkPeriodLock({ month: SEED_LOCKED_MONTH, periods, now }).ok) {
      const requestedAt = new Date(now.getTime() - 3 * DAY_MS);
      const decidedAt = new Date(now.getTime() - 2 * DAY_MS);
      await tx.insert(financeApproval).values({
        id: IDS.lockRequest,
        operation: "period_lock",
        payload: { month: SEED_LOCKED_MONTH },
        status: "approved",
        requestedByUserId: finance.id,
        requestedAt,
        expiresAt: approvalExpiresAt(requestedAt, 7),
        decidedByUserId: approver.id,
        decidedAt,
      });
      const locked = {
        status: "locked" as const,
        lockedAt: decidedAt,
        lockedByUserId: approver.id,
      };
      await tx
        .insert(ledgerPeriod)
        .values({ month: SEED_LOCKED_MONTH, createdAt: requestedAt, ...locked })
        .onConflictDoUpdate({ target: ledgerPeriod.month, set: locked });
    }

    await tx.insert(financeApproval).values([
      {
        id: IDS.pendingLock,
        operation: "period_lock",
        payload: { month: SEED_PENDING_LOCK_MONTH },
        requestedByUserId: finance.id,
        requestedAt: now,
        expiresAt: approvalExpiresAt(now, 7),
      },
      {
        id: IDS.pendingEntry,
        operation: "manual_entry",
        payload: {
          date: istDateOf(now),
          description: "Deposit for the awards day venue",
          lines: [
            { accountCode: "5600", side: "debit", amountMinor: "7500000" },
            { accountCode: "1000", side: "credit", amountMinor: "7500000" },
          ],
        },
        requestedByUserId: finance.id,
        requestedAt: now,
        expiresAt: approvalExpiresAt(now, 7),
      },
    ]);
  });
};
