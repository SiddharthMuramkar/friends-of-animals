import { describe, expect, it } from "vitest";

import { ledgerExportDownload } from "@/app/(staff)/admin/ledger/_lib/export-download";
import { parseCsv } from "@/server/modules/registration/domain/csv";
import { createHarness, type Harness } from "@/test/harness";

import { ledgerTrialBalance, postToLedger } from "./index";
import { ledgerAudit, signInAs, type Staff } from "./testing";

// #109 unit 109b: the accountant's export. Every line of every posting
// that happened on the IST days asked for, as a CSV whose debits equal its
// credits. The harness clock starts on 15 January 2027 (IST).

async function entry(
  h: Harness,
  finance: Staff,
  date: string,
  amountMinor: bigint,
  description = `Supplies bought on ${date}`
) {
  const posted = await h.as(finance.actor).createManualEntry({
    date,
    description,
    lines: [
      { accountCode: "5300", side: "debit", amountMinor, memo: "Courier" },
      { accountCode: "1000", side: "credit", amountMinor },
    ],
  });
  if (!posted.ok || posted.status !== "posted")
    throw new Error(JSON.stringify(posted));
  return posted;
}

/** A posting at an exact instant, as the worker writes captures. */
async function postedAt(h: Harness, occurredAt: Date, id: string) {
  await h.db.transaction((tx) =>
    postToLedger(
      tx,
      { actor: { kind: "system", process: "seed" }, clock: h.clock },
      {
        source: { type: "manual", id },
        occurredAt,
        description: `Posted at ${occurredAt.toISOString()}`,
        lines: [
          { accountCode: "1010", side: "debit", amountMinor: 700n },
          { accountCode: "1000", side: "credit", amountMinor: 700n },
        ],
      }
    )
  );
}

function rowsOf(csv: string) {
  const parsed = parseCsv(csv);
  if (!parsed.ok) throw new Error(`Not CSV: ${parsed.reason}`);
  const [header, ...rows] = parsed.records;
  return rows.map((row) =>
    Object.fromEntries(header!.map((column, index) => [column, row[index]]))
  );
}

async function exporter(h: Harness) {
  await h.settings.set("ledger.accountantExport", true);
  return signInAs(h);
}

describe("the accountant's export", () => {
  it("balances: its debits equal its credits and the trial balance for the same IST days", async () => {
    const h = await createHarness();
    const finance = await exporter(h);
    await entry(h, finance, "2027-01-01", 12_345n);
    const second = await entry(h, finance, "2027-01-10", 80_000n);
    await h.as(finance.actor).reversePosting(second.seq);
    await entry(h, finance, "2026-12-31", 99_999n);

    const result = await h
      .as(finance.actor)
      .exportLedger({ from: "2027-01-01", to: "2027-01-31" });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const rows = rowsOf(result.csv);
    const lines = rows.filter(({ seq }) => seq !== "TOTAL");
    const paise = (value: string | undefined) =>
      BigInt(Math.round(Number(value) * 100));
    const debits = lines.reduce(
      (total, row) => total + paise(row.debit_inr),
      0n
    );
    const credits = lines.reduce(
      (total, row) => total + paise(row.credit_inr),
      0n
    );
    const trial = await ledgerTrialBalance(h.db, {
      from: "2027-01-01",
      to: "2027-01-31",
    });

    expect(debits).toBe(credits);
    expect(debits).toBe(trial.debitMinor);
    expect(credits).toBe(trial.creditMinor);
    expect(debits).toBe(12_345n + 80_000n * 2n);
    expect(rows.at(-1)).toMatchObject({
      seq: "TOTAL",
      debit_inr: "1723.45",
      credit_inr: "1723.45",
    });
    expect(result).toMatchObject({
      filename: "foa-ledger-2027-01-01-2027-01-31.csv",
      postingCount: 3,
      lineCount: 6,
      totals: { debitMinor: 172_345n, creditMinor: 172_345n },
    });
    expect(
      lines.map(({ seq, date_ist, reversal_of_seq }) => [
        seq,
        date_ist,
        reversal_of_seq,
      ])
    ).toEqual([
      ["1", "2027-01-01", ""],
      ["1", "2027-01-01", ""],
      ["2", "2027-01-10", ""],
      ["2", "2027-01-10", ""],
      ["3", "2027-01-15", "2"],
      ["3", "2027-01-15", "2"],
    ]);
    expect(lines[0]).toMatchObject({
      account_code: "5300",
      account_name: "Logistics",
      debit_inr: "123.45",
      credit_inr: "0.00",
      memo: "Courier",
      source_type: "manual",
      late_adjustment: "false",
    });
  });

  it("takes exactly the postings dated on IST days inside the range", async () => {
    const h = await createHarness();
    const finance = await exporter(h);
    // 23:59:59.999 on 31 December IST, then midnight on 1 January IST.
    await postedAt(
      h,
      new Date("2026-12-31T18:29:59.999Z"),
      "01938a00-0000-7000-8000-000000109101"
    );
    await postedAt(
      h,
      new Date("2026-12-31T18:30:00.000Z"),
      "01938a00-0000-7000-8000-000000109102"
    );

    const january = await h
      .as(finance.actor)
      .exportLedger({ from: "2027-01-01", to: "2027-01-01" });
    const december = await h
      .as(finance.actor)
      .exportLedger({ from: "2026-12-31", to: "2026-12-31" });
    if (!january.ok || !december.ok) throw new Error("export refused");
    expect(
      rowsOf(january.csv)
        .filter(({ seq }) => seq !== "TOTAL")
        .map(({ seq }) => seq)
    ).toEqual(["2", "2"]);
    expect(
      rowsOf(december.csv)
        .filter(({ seq }) => seq !== "TOTAL")
        .map(({ seq }) => seq)
    ).toEqual(["1", "1"]);
  });

  it("writes a narration that looks like a formula as text, and keeps amounts numeric", async () => {
    const h = await createHarness();
    const finance = await exporter(h);
    await entry(h, finance, "2027-01-02", 5_000n, '=HYPERLINK("x")');
    const result = await h
      .as(finance.actor)
      .exportLedger({ from: "2027-01-02", to: "2027-01-02" });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const [first] = rowsOf(result.csv);
    expect(first).toMatchObject({
      narration: '\'=HYPERLINK("x")',
      debit_inr: "50.00",
    });
  });

  it("writes one audit entry with the range and counts, never the content", async () => {
    const h = await createHarness();
    const finance = await exporter(h);
    await entry(h, finance, "2027-01-02", 5_000n, "Private counterparty name");
    await h
      .as(finance.actor)
      .exportLedger({ from: "2027-01-01", to: "2027-01-15" });

    const exported = (await ledgerAudit(h)).filter(
      ({ action }) => action === "ledger.exported"
    );
    expect(exported).toEqual([
      expect.objectContaining({
        actorUserId: finance.userId,
        actorRole: "finance",
        entityType: "ledger_export",
        after: {
          from: "2027-01-01",
          to: "2027-01-15",
          postingCount: 1,
          lineCount: 2,
        },
      }),
    ]);
    expect(JSON.stringify(exported)).not.toContain("Private counterparty");
  });

  it("needs a fresh second factor", async () => {
    const h = await createHarness();
    const finance = await exporter(h);
    h.clock.advance({ minutes: 10, seconds: 1 });
    await expect(
      h.as(finance.actor).exportLedger({ from: "2027-01-01", to: "2027-01-15" })
    ).rejects.toMatchObject({ code: "step_up_required" });
    expect(
      (await ledgerAudit(h)).filter(
        ({ action }) => action === "ledger.exported"
      )
    ).toEqual([]);
  });

  it("stays off until a super admin turns it on (HR-47)", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    expect(
      await h
        .as(finance.actor)
        .exportLedger({ from: "2027-01-01", to: "2027-01-15" })
    ).toEqual({ ok: false, error: "export_not_enabled" });
  });

  it.each([
    [{ from: "2027-01-01", to: "" }, "invalid_date"],
    [{ from: "2027-02-30", to: "2027-03-01" }, "invalid_date"],
    [{ from: "2027-01-15", to: "2027-01-14" }, "range_reversed"],
    [{ from: "2026-01-01", to: "2027-01-02" }, "range_too_long"],
  ] as const)("refuses %j with %s", async (input, error) => {
    const h = await createHarness();
    const finance = await exporter(h);
    expect(await h.as(finance.actor).exportLedger(input)).toEqual({
      ok: false,
      error,
    });
  });

  it("covers a whole leap year", async () => {
    const h = await createHarness();
    const finance = await exporter(h);
    expect(
      await h
        .as(finance.actor)
        .exportLedger({ from: "2028-01-01", to: "2028-12-31" })
    ).toMatchObject({ ok: true, postingCount: 0 });
  });
});

describe("the export download", () => {
  it("is a CSV attachment that is never cached", async () => {
    const h = await createHarness();
    const finance = await exporter(h);
    await entry(h, finance, "2027-01-02", 5_000n);
    const download = await ledgerExportDownload(h.as(finance.actor), {
      from: "2027-01-01",
      to: "2027-01-15",
    });
    expect(download).toMatchObject({
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="foa-ledger-2027-01-01-2027-01-15.csv"',
        "Cache-Control": "no-store",
      },
    });
    if (download.status !== 200) return;
    expect(download.body.startsWith("﻿seq,date_ist,period,")).toBe(true);
  });

  it("sends a stale second factor to step up and back to the export page", async () => {
    const h = await createHarness();
    const finance = await exporter(h);
    h.clock.advance({ minutes: 11 });
    expect(
      await ledgerExportDownload(h.as(finance.actor), {
        from: "2027-01-01",
        to: "2027-01-15",
      })
    ).toEqual({
      status: 303,
      location: `/auth/step-up?next=${encodeURIComponent(
        "/admin/ledger/export?from=2027-01-01&to=2027-01-15"
      )}`,
    });
  });

  it("sends a bad range back to the export page with the reason", async () => {
    const h = await createHarness();
    const finance = await exporter(h);
    expect(
      await ledgerExportDownload(h.as(finance.actor), {
        from: "2027-01-15",
        to: "2027-01-01",
      })
    ).toEqual({
      status: 303,
      location:
        "/admin/ledger/export?from=2027-01-15&to=2027-01-01&error=range_reversed",
    });
  });

  it.each(["staff_admin", "super_admin", "competition_manager", null] as const)(
    "gives a %s who doesn't hold finance no file",
    async (role) => {
      const h = await createHarness();
      await h.settings.set("ledger.accountantExport", true);
      const other = await signInAs(h, role);
      await expect(
        h.as(other.actor).exportLedger({ from: "2027-01-01", to: "2027-01-15" })
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(
        await ledgerExportDownload(h.as(other.actor), {
          from: "2027-01-01",
          to: "2027-01-15",
        })
      ).toMatchObject({ status: 403, body: null });
    }
  );

  it("gives a visitor no file", async () => {
    const h = await createHarness();
    expect(
      await ledgerExportDownload(h.as(h.visitor()), {
        from: "2027-01-01",
        to: "2027-01-15",
      })
    ).toMatchObject({ status: 403 });
  });
});
