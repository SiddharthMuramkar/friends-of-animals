import { eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { messages } from "@/i18n/messages";
import {
  auditLog,
  ledgerAccount,
  ledgerLine,
  ledgerPosting,
} from "@/server/db/schema";
import { capturedBatch } from "@/server/modules/payments/refunds/testing";
import { signInStaff } from "@/server/modules/payments/testing";
import { createHarness, type Harness } from "@/test/harness";

import type { LedgerSourceType } from "./domain/posting-rules";
import { postToLedger } from "./index";

const DATE = "2027-01-01";
const LINES = [
  {
    accountCode: "5100",
    side: "debit",
    amountMinor: 12_345n,
    memo: "Private test memo",
  },
  { accountCode: "1000", side: "credit", amountMinor: 12_345n },
] as const;
const ENTRY = {
  date: DATE,
  description: "Private test description",
  lines: LINES,
};
const CATEGORY = { code: "5110", name: "Venue hire", kind: "expense" } as const;

const audit = (h: Harness) =>
  h.db
    .select()
    .from(auditLog)
    .where(like(auditLog.action, "ledger.%"))
    .orderBy(auditLog.id);

describe("the shared ledger writer", () => {
  it("refuses an unregistered source type without writing journal or audit rows", async () => {
    const h = await createHarness();
    const { actor } = await signInStaff(h);
    await expect(
      h.db.transaction((tx) =>
        postToLedger(
          tx,
          { actor, clock: h.clock, actorRole: "finance" },
          {
            source: {
              type: "unregistered_source" as LedgerSourceType,
              id: "unregistered-test-source",
            },
            occurredAt: h.clock.now(),
            description: ENTRY.description,
            lines: LINES,
          }
        )
      )
    ).rejects.toMatchObject({ code: "invalid_source_type" });
    expect(await h.db.select().from(ledgerPosting)).toEqual([]);
    expect(await h.db.select().from(ledgerLine)).toEqual([]);
    expect(await audit(h)).toEqual([]);
  });
});

describe("manual entries", () => {
  it("books a balanced entry on the chosen IST day and audits it without its free text", async () => {
    const h = await createHarness();
    const { actor, userId } = await signInStaff(h);
    const result = await h.as(actor).createManualEntry(ENTRY);
    expect(result).toMatchObject({ ok: true, seq: 1n });
    const [posted] = await h.db.select().from(ledgerPosting);
    expect(posted).toMatchObject({
      sourceType: "manual",
      sourceId: posted!.id,
      expectedLineCount: 2,
      periodMonth: "2027-01",
      occurredAt: new Date("2026-12-31T18:30:00Z"),
      description: ENTRY.description,
      createdByUserId: userId,
    });
    expect(
      await h.db.select().from(ledgerLine).orderBy(ledgerLine.lineNo)
    ).toMatchObject([
      {
        debitMinor: 12_345n,
        creditMinor: 0n,
        memo: LINES[0].memo,
        currency: "INR",
      },
      { debitMinor: 0n, creditMinor: 12_345n, memo: null, currency: "INR" },
    ]);
    const logged = await audit(h);
    expect(logged).toEqual([
      expect.objectContaining({
        action: "ledger.posting_created",
        actorUserId: userId,
        actorRole: "finance",
        entityId: posted!.id,
        after: expect.objectContaining({
          accountCodes: ["5100", "1000"],
          totalMinor: "12345",
          lineCount: 2,
        }),
      }),
    ]);
    expect(JSON.stringify(logged)).not.toMatch(/Private test/);
  });

  it("refuses invalid entries without writing a header, line or audit", async () => {
    const h = await createHarness();
    const { actor } = await signInStaff(h);
    const create = h.as(actor).createManualEntry;
    const [debit, credit] = LINES;
    const cases = [
      [
        { ...ENTRY, lines: [debit, { ...credit, amountMinor: 1n }] },
        "unbalanced",
      ],
      [{ ...ENTRY, lines: [debit] }, "too_few_lines"],
      [
        {
          ...ENTRY,
          lines: [...Array.from({ length: 19 }, () => debit), ...LINES],
        },
        "too_many_lines",
      ],
      [
        { ...ENTRY, lines: [{ ...debit, amountMinor: 0n }, credit] },
        "non_positive_amount",
      ],
      [
        { ...ENTRY, lines: [{ ...debit, accountCode: "5999" }, credit] },
        "unknown_account",
      ],
      [{ ...ENTRY, date: "2027-01-16" }, "future_date"],
      [{ ...ENTRY, date: "2027-02-30" }, "invalid_date"],
      [{ ...ENTRY, description: " " }, "invalid_description"],
    ] as const;
    for (const [input, error] of cases) {
      expect(await create(input)).toEqual({ ok: false, error });
    }
    expect(await h.db.select().from(ledgerPosting)).toEqual([]);
    expect(await h.db.select().from(ledgerLine)).toEqual([]);
    expect(await audit(h)).toEqual([]);
  });
});

describe("ledger categories and corrections", () => {
  it("audits only the category fields that actually changed", async () => {
    const h = await createHarness();
    const { actor } = await signInStaff(h);
    const app = h.as(actor);
    expect(await app.createLedgerAccount(CATEGORY)).toMatchObject({ ok: true });
    expect(
      await app.updateLedgerAccount({
        code: CATEGORY.code,
        name: CATEGORY.name,
        publicLabel: "Competition venues",
        publicGroup: "programs",
      })
    ).toMatchObject({ ok: true });

    const updated = (await audit(h)).find(
      (row) => row.action === "ledger.account_updated"
    );
    expect(updated?.after).toMatchObject({ changedFields: ["publicLabel"] });
    expect(JSON.stringify(updated)).not.toContain("Competition venues");
  });

  it("creates, labels and deactivates a category, preserving its history and audit", async () => {
    const h = await createHarness();
    const { actor } = await signInStaff(h);
    const app = h.as(actor);
    expect(
      await app.createLedgerAccount({ ...CATEGORY, kind: "asset" })
    ).toEqual({ ok: false, error: "kind_not_allowed" });
    expect(
      await app.createLedgerAccount({ ...CATEGORY, code: "4110" })
    ).toEqual({ ok: false, error: "code_out_of_range" });
    expect(await app.createLedgerAccount(CATEGORY)).toMatchObject({ ok: true });
    expect(await app.createLedgerAccount(CATEGORY)).toEqual({
      ok: false,
      error: "code_taken",
    });
    expect(
      await app.updateLedgerAccount({
        code: CATEGORY.code,
        name: "Venue and setup",
        publicLabel: "Competition venues",
        publicGroup: "fundraising",
      })
    ).toMatchObject({ ok: true });
    expect(
      await app.updateLedgerAccount({ code: "4100", name: "Renamed" })
    ).toEqual({ ok: false, error: "system_account" });
    expect(await app.deactivateLedgerAccount({ code: "4100" })).toEqual({
      ok: false,
      error: "system_account",
    });
    const manual = {
      ...ENTRY,
      lines: [{ ...LINES[0], accountCode: CATEGORY.code }, LINES[1]],
    };
    expect(await app.createManualEntry(manual)).toMatchObject({ ok: true });
    expect(
      await app.deactivateLedgerAccount({ code: CATEGORY.code })
    ).toMatchObject({ ok: true });
    expect(await app.createManualEntry(manual)).toEqual({
      ok: false,
      error: "inactive_account",
    });
    const [account] = await h.db
      .select()
      .from(ledgerAccount)
      .where(eq(ledgerAccount.code, CATEGORY.code));
    expect(account).toMatchObject({
      name: "Venue and setup",
      publicLabel: "Competition venues",
      publicGroup: "fundraising",
      isActive: false,
    });
    expect(
      await h.db
        .select()
        .from(ledgerLine)
        .where(eq(ledgerLine.accountId, account!.id))
    ).toHaveLength(1);
    expect((await audit(h)).map((row) => row.action)).toEqual([
      "ledger.account_created",
      "ledger.account_updated",
      "ledger.posting_created",
      "ledger.account_deactivated",
    ]);
  });

  it("reverses a manual entry exactly once, including when its category has since been deactivated", async () => {
    const h = await createHarness();
    const { actor } = await signInStaff(h);
    const app = h.as(actor);
    expect(await app.createManualEntry(ENTRY)).toMatchObject({
      ok: true,
      seq: 1n,
    });
    await app.deactivateLedgerAccount({ code: "5100" });
    const result = await app.reversePosting(1n);
    expect(result).toMatchObject({ ok: true, seq: 2n });
    expect(await app.reversePosting(1n)).toEqual({
      ok: false,
      error: "already_reversed",
    });
    expect(await app.reversePosting(2n)).toEqual({
      ok: false,
      error: "not_reversible",
    });
    const [original, reversed] = await h.db
      .select()
      .from(ledgerPosting)
      .orderBy(ledgerPosting.seq);
    expect(reversed).toMatchObject({
      sourceType: "reversal",
      sourceId: original!.id,
      reversalOfPostingId: original!.id,
      description: messages.adminLedger.postingDescriptions.reversal.replace(
        "{seq}",
        "1"
      ),
    });
    expect(
      await h.db
        .select()
        .from(ledgerLine)
        .where(eq(ledgerLine.postingId, reversed!.id))
        .orderBy(ledgerLine.lineNo)
    ).toMatchObject([
      { debitMinor: 0n, creditMinor: 12_345n },
      { debitMinor: 12_345n, creditMinor: 0n },
    ]);
    expect((await audit(h)).map((row) => row.action)).toEqual([
      "ledger.posting_created",
      "ledger.account_deactivated",
      "ledger.posting_reversed",
    ]);
  });

  it("refuses to reverse an automatic capture", async () => {
    const h = await createHarness();
    await capturedBatch(h, { students: 1 });
    await h.drain();
    const { actor } = await signInStaff(h);
    expect(await h.as(actor).reversePosting(1n)).toEqual({
      ok: false,
      error: "not_reversible",
    });
    expect((await audit(h)).map((row) => row.action)).toEqual([
      "ledger.posting_created",
    ]);
  });
});

describe("finance write authorization", () => {
  async function expectRefused(app: ReturnType<Harness["as"]>, code: string) {
    await expect(app.createManualEntry(ENTRY)).rejects.toMatchObject({ code });
    await expect(app.reversePosting(1n)).rejects.toMatchObject({ code });
    await expect(app.createLedgerAccount(CATEGORY)).rejects.toMatchObject({
      code,
    });
    await expect(
      app.updateLedgerAccount({ code: "5100", name: "New name" })
    ).rejects.toMatchObject({ code });
    await expect(
      app.deactivateLedgerAccount({ code: "5100" })
    ).rejects.toMatchObject({ code });
  }

  it.each(["competition_manager", "staff_admin", "super_admin", null] as const)(
    "refuses all finance writes for %s without a finance grant",
    async (role) => {
      const h = await createHarness();
      const { actor } = await signInStaff(h, role);
      await expectRefused(h.as(actor), "forbidden");
      expect(await audit(h)).toEqual([]);
    }
  );

  it("needs the staff second factor in the finance user's own session", async () => {
    const h = await createHarness();
    const user = await h.seed.member();
    await h.seed.grant(user, { role: "finance", scope: { type: "global" } });
    await h.seed.authenticator(user);
    const actor = await h.signIn(user, undefined, { secondFactor: false });
    await expectRefused(h.as(actor), "second_factor_required");
    expect(await audit(h)).toEqual([]);
  });

  it("refuses reads and writes in an existing finance session after revocation", async () => {
    const h = await createHarness();
    const { actor, userId } = await signInStaff(h);
    const finance = h.as(actor);
    expect(await finance.createManualEntry(ENTRY)).toMatchObject({
      ok: true,
      seq: 1n,
    });
    expect(await finance.listPostings({})).toMatchObject({ ok: true });
    expect(await finance.getPosting(1n)).toMatchObject({ ok: true });
    expect(await finance.listLedgerAccounts()).toContainEqual(
      expect.objectContaining({ code: "5100" })
    );
    const before = await audit(h);

    const admin = await h.signIn(await h.seed.superAdmin());
    expect(
      await h.as(admin).revokeRole({
        userId,
        role: "finance",
        scope: { type: "global" },
      })
    ).toMatchObject({ ok: true, changed: true });

    await expect(finance.listPostings({})).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(finance.getPosting(1n)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(finance.listLedgerAccounts()).rejects.toMatchObject({
      code: "forbidden",
    });
    await expectRefused(finance, "forbidden");
    expect(await audit(h)).toEqual(before);
  });
});
