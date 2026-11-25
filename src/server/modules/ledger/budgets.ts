// Budgets and budget versus actual (#109). Finance sets a budget per
// category (an income or expense account) per IST month; the report puts
// the ledger's actual for each month beside it. A posting counts in its
// `period_month`, so a late adjustment counts in the month it landed in.
// The rules are pure, in ./domain/budget.ts.

import { and, asc, between, eq, inArray, or, sum } from "drizzle-orm";
import { z } from "zod";

import { authorize, type PolicyContext } from "../../access/can";
import { recordAudit } from "../../audit/record";
import {
  ledgerAccount,
  ledgerBudget,
  ledgerLine,
  ledgerPosting,
} from "../../db/schema";
import { uuidv7 } from "../../ids";

import {
  budgetVsActual as compareBudgets,
  isBudgetableKind,
  parseBudgetAmount,
  resolveMonthRange,
} from "./domain/budget";
import { isPeriodMonth } from "./domain/period";

const budgetInput = z.object({
  accountCode: z.string().regex(/^\d{4}$/),
  periodMonth: z.string().refine(isPeriodMonth),
  /** Rupees as typed ("50,000"); empty clears the budget. */
  amount: z.string().max(32),
});

/** Sets, changes or (with an empty amount) clears one month's budget. */
export async function setBudget(
  ctx: PolicyContext,
  input: { accountCode: string; periodMonth: string; amount: string }
) {
  const { role } = await authorize(ctx, "ledger.budget_set");
  const parsed = budgetInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" } as const;
  const { accountCode, periodMonth } = parsed.data;
  const typed = parsed.data.amount.trim();
  const amount = typed === "" ? null : parseBudgetAmount(typed);
  if (amount && !amount.ok) return { ok: false, error: amount.reason } as const;
  const amountMinor = amount ? amount.amountMinor : null;
  if (ctx.actor.kind !== "user") throw new Error("Budgets are set by a user");
  const userId = ctx.actor.userId;

  return ctx.db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(ledgerAccount)
      .where(eq(ledgerAccount.code, accountCode));
    if (!account) return { ok: false, error: "not_found" } as const;
    if (!isBudgetableKind(account.kind))
      return { ok: false, error: "not_budgetable" } as const;
    const [before] = await tx
      .select()
      .from(ledgerBudget)
      .where(
        and(
          eq(ledgerBudget.accountId, account.id),
          eq(ledgerBudget.periodMonth, periodMonth)
        )
      )
      .for("update");
    if (!account.isActive && amountMinor !== null)
      return { ok: false, error: "inactive_account" } as const;
    if ((before?.amountMinor ?? null) === amountMinor)
      return { ok: true, amountMinor, changed: false } as const;

    const now = ctx.clock.now();
    let budgetId: string;
    if (amountMinor === null) {
      // Only reached with a stored budget: clearing nothing is no change.
      budgetId = before!.id;
      await tx.delete(ledgerBudget).where(eq(ledgerBudget.id, budgetId));
    } else if (before) {
      budgetId = before.id;
      await tx
        .update(ledgerBudget)
        .set({ amountMinor, updatedByUserId: userId, updatedAt: now })
        .where(eq(ledgerBudget.id, budgetId));
    } else {
      budgetId = uuidv7(now);
      await tx.insert(ledgerBudget).values({
        id: budgetId,
        accountId: account.id,
        periodMonth,
        amountMinor,
        createdByUserId: userId,
        updatedByUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await recordAudit(tx, ctx, {
      action: "ledger.budget_set",
      entity: { type: "ledger_budget", id: budgetId },
      before: before
        ? {
            accountCode,
            periodMonth,
            amountMinor: before.amountMinor.toString(),
          }
        : null,
      after:
        amountMinor === null
          ? null
          : { accountCode, periodMonth, amountMinor: amountMinor.toString() },
      actorRole: role,
    });
    return { ok: true, amountMinor, changed: true } as const;
  });
}

/**
 * Budget versus actual for each category over a range of months (the
 * current financial year by default): every active income and expense
 * category, and inactive ones with a budget or activity in the range.
 */
export async function budgetVsActual(
  ctx: PolicyContext,
  input: { from?: string; to?: string } = {}
) {
  await authorize(ctx, "ledger.read");
  const range = resolveMonthRange(input, ctx.clock.now());
  if (!range.ok) return range;
  const { months } = range;
  const first = months[0]!;
  const last = months.at(-1)!;

  return ctx.db.transaction(
    async (tx) => {
      const categories = await tx
        .select({
          id: ledgerAccount.id,
          code: ledgerAccount.code,
          name: ledgerAccount.name,
          kind: ledgerAccount.kind,
          isActive: ledgerAccount.isActive,
        })
        .from(ledgerAccount)
        .where(inArray(ledgerAccount.kind, ["income", "expense"]))
        .orderBy(asc(ledgerAccount.code));
      const budgets = await tx
        .select({
          accountId: ledgerBudget.accountId,
          periodMonth: ledgerBudget.periodMonth,
          amountMinor: ledgerBudget.amountMinor,
        })
        .from(ledgerBudget)
        .where(between(ledgerBudget.periodMonth, first, last));
      const activity = (
        await tx
          .select({
            accountId: ledgerLine.accountId,
            periodMonth: ledgerPosting.periodMonth,
            debitMinor: sum(ledgerLine.debitMinor),
            creditMinor: sum(ledgerLine.creditMinor),
          })
          .from(ledgerLine)
          .innerJoin(ledgerPosting, eq(ledgerPosting.id, ledgerLine.postingId))
          .innerJoin(ledgerAccount, eq(ledgerAccount.id, ledgerLine.accountId))
          .where(
            and(
              between(ledgerPosting.periodMonth, first, last),
              or(
                eq(ledgerAccount.kind, "income"),
                eq(ledgerAccount.kind, "expense")
              )
            )
          )
          .groupBy(ledgerLine.accountId, ledgerPosting.periodMonth)
      ).map((row) => ({
        ...row,
        debitMinor: BigInt(row.debitMinor ?? 0),
        creditMinor: BigInt(row.creditMinor ?? 0),
      }));
      const used = new Set([
        ...budgets.map(({ accountId }) => accountId),
        ...activity.map(({ accountId }) => accountId),
      ]);
      const accounts = categories.filter(
        (account) => account.isActive || used.has(account.id)
      );
      const report = compareBudgets({ accounts, months, budgets, activity });
      const active = new Map(accounts.map((a) => [a.id, a.isActive]));
      return {
        ok: true,
        months,
        rows: report.rows.map((row) => ({
          ...row,
          isActive: active.get(row.account.id) ?? true,
        })),
        totals: report.totals,
      } as const;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
