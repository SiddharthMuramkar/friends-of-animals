import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { financeApproval, ledgerPeriod, user } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import {
  SEED_LEDGER_APPROVER,
  SEED_LEDGER_FINANCE,
  SEED_LOCKED_MONTH,
  SEED_PENDING_LOCK_MONTH,
} from "./ledger-periods";

describe("the ledger periods seed (#109)", () => {
  it("locks March 2026, leaves a lock and a large entry waiting, and changes nothing the second time", async () => {
    const h = await createHarness();
    const state = async () => ({
      periods: await h.db
        .select({ month: ledgerPeriod.month, status: ledgerPeriod.status })
        .from(ledgerPeriod)
        .orderBy(asc(ledgerPeriod.month)),
      requests: await h.db
        .select({
          operation: financeApproval.operation,
          status: financeApproval.status,
          requester: user.email,
        })
        .from(financeApproval)
        .innerJoin(user, eq(user.id, financeApproval.requestedByUserId))
        .orderBy(asc(financeApproval.id)),
    });

    await h.seed.preview();
    const first = await state();
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await state()).toEqual(first);
    expect(first.periods).toContainEqual({
      month: SEED_LOCKED_MONTH,
      status: "locked",
    });
    expect(
      first.periods.filter(({ status }) => status === "locked")
    ).toHaveLength(1);
    expect(first.requests).toEqual([
      {
        operation: "period_lock",
        status: "approved",
        requester: SEED_LEDGER_FINANCE.email,
      },
      {
        operation: "period_lock",
        status: "pending",
        requester: SEED_LEDGER_FINANCE.email,
      },
      {
        operation: "manual_entry",
        status: "pending",
        requester: SEED_LEDGER_FINANCE.email,
      },
    ]);
  });

  it("gives the second finance user a request they can approve", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const [approver] = await h.db
      .select()
      .from(user)
      .where(eq(user.email, SEED_LEDGER_APPROVER.email));
    const actor = await h.signIn({ ...approver!, email: approver!.email! });

    const { pending } = await h.as(actor).listFinanceRequests();
    expect(
      pending.map(({ summary, canApprove }) => [summary.kind, canApprove])
    ).toEqual([
      ["period_lock", true],
      ["manual_entry", true],
    ]);
    const lock = pending.find(({ summary }) => summary.kind === "period_lock");
    expect(lock?.summary).toMatchObject({ month: SEED_PENDING_LOCK_MONTH });
    expect(
      await h.as(actor).approveFinanceRequest({ requestId: lock!.id })
    ).toEqual({ ok: true, status: "approved" });
  });
});
