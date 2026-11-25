// Test helpers for the ledger's period lock, two-approver rule, budgets
// and export (#109). Seam 1 only: app code never imports this file.

import { asc, eq, like, or } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import {
  auditLog,
  financeApproval,
  ledgerPeriod,
  ledgerPosting,
} from "@/server/db/schema";
import type { Harness } from "@/test/harness";

type SeededUser = Awaited<ReturnType<Harness["seed"]["member"]>>;

export type Staff = {
  actor: Actor;
  userId: string;
  name: string;
  user: SeededUser;
};

/**
 * A signed-in user holding `role` globally (none for a plain member), who
 * passed their second factor on signing in, as staff do.
 */
export async function signInAs(
  h: Harness,
  role:
    | "finance"
    | "staff_admin"
    | "super_admin"
    | "competition_manager"
    | null = "finance"
): Promise<Staff> {
  const user = await h.seed.member();
  if (role) await h.seed.grant(user, { role, scope: { type: "global" } });
  return {
    actor: await h.signIn(user),
    userId: user.id,
    name: user.name,
    user,
  };
}

/** A new session for the same person: staff sessions end after 12 hours. */
export async function signInAgain(h: Harness, staff: Staff): Promise<Staff> {
  return { ...staff, actor: await h.signIn(staff.user) };
}

/** Two different finance users, both signed in with a fresh second factor. */
export async function twoFinanceUsers(h: Harness) {
  const requester = await signInAs(h, "finance");
  const approver = await signInAs(h, "finance");
  return { requester, approver };
}

/** Passes the second factor again, as the step-up page does. */
export async function stepUp(h: Harness, staff: Staff) {
  await h.passSecondFactor(staff.actor);
}

export async function periodRows(h: Harness) {
  return h.db.select().from(ledgerPeriod).orderBy(asc(ledgerPeriod.month));
}

export async function periodRow(h: Harness, month: string) {
  const [row] = await h.db
    .select()
    .from(ledgerPeriod)
    .where(eq(ledgerPeriod.month, month));
  return row;
}

export async function requestRow(h: Harness, requestId: string) {
  const [row] = await h.db
    .select()
    .from(financeApproval)
    .where(eq(financeApproval.id, requestId));
  if (!row) throw new Error(`No finance request ${requestId}`);
  return row;
}

export async function requestRows(h: Harness) {
  return h.db.select().from(financeApproval).orderBy(financeApproval.id);
}

export async function postingRows(h: Harness) {
  return h.db.select().from(ledgerPosting).orderBy(asc(ledgerPosting.seq));
}

/** The ledger's audit entries, oldest first. */
export async function ledgerAudit(h: Harness) {
  return h.db
    .select()
    .from(auditLog)
    .where(
      or(
        like(auditLog.action, "ledger.%"),
        eq(auditLog.entityType, "finance_approval")
      )
    )
    .orderBy(auditLog.id);
}

/** A balanced manual entry of `amountMinor` on `date`: a venue expense paid from the bank. */
export function expenseEntry(
  date: string,
  amountMinor: bigint,
  description = "Hall hire for the awards day"
) {
  return {
    date,
    description,
    lines: [
      { accountCode: "5600", side: "debit", amountMinor },
      { accountCode: "1000", side: "credit", amountMinor },
    ] as const,
  };
}
