import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import {
  registration,
  certificate,
  ledgerPosting,
  ledgerAccount,
  ledgerLine,
} from "../../db/schema";
import { insertCertificate } from "../certificates/issue";
import { signedInWith, managerOf } from "../judging/testing";
import { schoolEntriesAtFoa, signedInVerifier } from "../verification/testing";
import { parseCsv } from "../registration/domain/csv";

describe("competition reports", () => {
  it("counts the independent facts, zero-fills both routes and respects competition scope", async () => {
    const h = await createHarness();
    const school = await schoolEntriesAtFoa(h);
    const other = await h.seed.competition({ code: "OTHR27" });
    const verifier = h.as(await signedInVerifier(h));
    expect(
      await verifier.verifyEntry({ entryId: school.entryIds[1]! })
    ).toMatchObject({ ok: true });
    const regs = await h.db
      .select()
      .from(registration)
      .where(eq(registration.competitionId, school.competition.id));
    const [a, b] = regs;
    for (const [r, revoked] of [
      [a!, false],
      [b!, true],
    ] as const) {
      const issued = await insertCertificate(h.db, h.clock, {
        type: "participation",
        competitionId: r.competitionId,
        registrationId: r.id,
        participantProfileId: r.participantProfileId,
        nameSnapshot: "Do not export this private name",
      });
      if (revoked)
        await h.db
          .update(certificate)
          .set({
            status: "revoked",
            revokedAt: h.clock.now(),
            revokedReason: "Revoked fixture",
          })
          .where(eq(certificate.id, issued.id));
    }
    const manager = h.as(
      await signedInWith(h, managerOf(school.competition.id))
    );
    const input = { competitionCode: school.competition.code };
    const report = await manager.getCompetitionReport(input);
    if (!report.ok) throw Error(report.error);
    expect(report.report.rows).toEqual([
      expect.objectContaining({
        route: "institution",
        ageGroupLabel: "6–9",
        registrations: 0,
        entries: 0,
        shortlisted: 0,
        verified: 0,
        certificates: 0,
      }),
      expect.objectContaining({
        route: "institution",
        ageGroupLabel: "10–13",
        registrations: 3,
        entries: 3,
        shortlisted: 2,
        verified: 1,
        certificates: 1,
      }),
      expect.objectContaining({
        route: "individual",
        ageGroupLabel: "6–9",
        registrations: 0,
        entries: 0,
        shortlisted: null,
        verified: 0,
        certificates: 0,
      }),
      expect.objectContaining({
        route: "individual",
        ageGroupLabel: "10–13",
        registrations: 0,
        entries: 0,
        shortlisted: null,
        verified: 0,
        certificates: 0,
      }),
    ]);
    expect(report.report.total).toEqual({
      registrations: 3,
      entries: 3,
      shortlisted: 2,
      verified: 1,
      certificates: 1,
    });
    expect(await manager.listReportCompetitions()).toEqual([
      expect.objectContaining({ id: school.competition.id }),
    ]);
    await expect(
      manager.getCompetitionReport({ competitionCode: other.code })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      manager.exportCompetitionReportCsv({ competitionCode: other.code })
    ).rejects.toMatchObject({ code: "forbidden" });
    const csv = await manager.exportCompetitionReportCsv(input);
    if (!csv.ok) throw Error(csv.error);
    expect(csv.csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.csv).not.toContain("Do not export this private name");
    expect(csv.csv).not.toContain(regs[0]!.registrationNumber!);
    expect(parseCsv(csv.csv)).toMatchObject({
      ok: true,
      records: expect.arrayContaining([
        ["institution", "10–13", "3", "3", "2", "1", "1"],
      ]),
    });
    const member = h.as(await h.signIn(await h.seed.member()));
    await expect(member.getCompetitionReport(input)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      member.exportCompetitionReportCsv(input)
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(member.listReportCompetitions()).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

it("counts fee captures per batch, completed refunds once, and real issued certificate rows", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const manager = h.as(
    await signedInWith(h, { role: "finance", scope: { type: "global" } })
  );
  const skies = await manager.getCompetitionReport({
    competitionCode: "SKIES26",
  });
  if (!skies.ok) throw Error(skies.error);
  expect(skies.report.fees).toEqual({
    currency: "INR",
    routes: [
      {
        route: "institution",
        totals: {
          capturedMinor: 600_000n,
          refundedMinor: 100_000n,
          netMinor: 500_000n,
        },
      },
      {
        route: "individual",
        totals: { capturedMinor: 0n, refundedMinor: 0n, netMinor: 0n },
      },
    ],
    total: {
      capturedMinor: 600_000n,
      refundedMinor: 100_000n,
      netMinor: 500_000n,
    },
  });
  const ledgerFees = await h.db
    .select({ debit: ledgerLine.debitMinor, credit: ledgerLine.creditMinor })
    .from(ledgerLine)
    .innerJoin(ledgerPosting, eq(ledgerPosting.id, ledgerLine.postingId))
    .innerJoin(ledgerAccount, eq(ledgerAccount.id, ledgerLine.accountId))
    .where(
      and(
        eq(ledgerPosting.competitionId, skies.report.competition.id),
        eq(ledgerAccount.code, "4100")
      )
    );
  expect(ledgerFees.reduce((n, row) => n + row.credit - row.debit, 0n)).toBe(
    500_000n
  );
  expect(skies.report.total).toMatchObject({
    registrations: 5,
    entries: 3,
    shortlisted: 2,
    verified: 0,
    certificates: 0,
  });
  const neighbours = await manager.getCompetitionReport({
    competitionCode: "NEIGH27",
  });
  if (!neighbours.ok) throw Error(neighbours.error);
  // A single captured ₹100 adult payment. The school batch is still open.
  expect(neighbours.report.fees).toEqual({
    currency: "INR",
    routes: [
      {
        route: "institution",
        totals: { capturedMinor: 0n, refundedMinor: 0n, netMinor: 0n },
      },
      {
        route: "individual",
        totals: {
          capturedMinor: 10_000n,
          refundedMinor: 0n,
          netMinor: 10_000n,
        },
      },
    ],
    total: { capturedMinor: 10_000n, refundedMinor: 0n, netMinor: 10_000n },
  });
  const mixed = await manager.getCompetitionReport({
    competitionCode: "ORIG27",
  });
  if (!mixed.ok) throw Error(mixed.error);
  expect(
    mixed.report.rows.map(
      ({ route, ageGroupLabel, registrations, entries, verified }) => [
        route,
        ageGroupLabel,
        registrations,
        entries,
        verified,
      ]
    )
  ).toEqual([
    ["institution", "Group A", 0, 0, 0],
    ["institution", "Group B", 3, 3, 3],
    ["institution", "Group C", 0, 0, 0],
    ["institution", "Adults", 0, 0, 0],
    ["individual", "Group A", 1, 1, 1],
    ["individual", "Group B", 0, 0, 0],
    ["individual", "Group C", 1, 1, 1],
    ["individual", "Adults", 2, 2, 2],
  ]);
  const auction = await manager.getCompetitionReport({
    competitionCode: "AUCT27",
  });
  if (!auction.ok) throw Error(auction.error);
  expect(auction.report.total).toEqual({
    registrations: 9,
    entries: 7,
    shortlisted: 0,
    verified: 7,
    certificates: 16,
  });
  expect(auction.report.routeTotals).toEqual([
    {
      route: "institution",
      totals: {
        registrations: 2,
        entries: 0,
        shortlisted: 0,
        verified: 0,
        certificates: 2,
      },
    },
    {
      route: "individual",
      totals: {
        registrations: 7,
        entries: 7,
        shortlisted: null,
        verified: 7,
        certificates: 14,
      },
    },
  ]);
  const csv = await manager.exportCompetitionReportCsv({
    competitionCode: "SKIES26",
  });
  if (!csv.ok) throw Error(csv.error);
  expect(parseCsv(csv.csv)).toMatchObject({
    ok: true,
    records: expect.arrayContaining([
      ["institution", "6000.00", "1000.00", "5000.00"],
    ]),
  });
});

it("neutralises formula-like labels, exports exact aggregate cells and audits the export only", async () => {
  const h = await createHarness();
  const comp = await h.seed.competition({
    code: "FORM27",
    name: '=HYPERLINK("example")',
    ageGroups: [{ label: "  @age", minAge: 18, maxAge: 99 }],
  });
  const admin = h.as(
    await signedInWith(h, { role: "super_admin", scope: { type: "global" } })
  );
  const report = await admin.getCompetitionReport({
    competitionCode: comp.code,
  });
  if (!report.ok) throw Error(report.error);
  const audit = () =>
    admin.searchAuditLog({
      action: "reports.exported",
      entityType: "competition",
      entityId: comp.id,
    });
  expect(await audit()).toMatchObject({ ok: true, entries: [] });
  const exported = await admin.exportCompetitionReportCsv({
    competitionCode: comp.code,
  });
  if (!exported.ok) throw Error(exported.error);
  expect(exported.csv.startsWith("\uFEFF")).toBe(true);
  expect(exported.csv.endsWith("\r\n")).toBe(true);
  expect(parseCsv(exported.csv)).toMatchObject({
    ok: true,
    records: expect.arrayContaining([
      ["competition", "FORM27", '\'=HYPERLINK("example")'],
      ["individual", "'@age", "0", "0", "", "0", "0"],
      ["all", "total", "0", "0", "0", "0", "0"],
    ]),
  });
  expect(await audit()).toMatchObject({
    ok: true,
    entries: [
      {
        entity: { type: "competition", id: comp.id },
        before: null,
        after: { report: "competition", format: "csv" },
      },
    ],
  });
  expect(
    await admin.getCompetitionReport({ competitionCode: "NONE27" })
  ).toMatchObject({ ok: false, error: "not_found" });
  expect(
    await admin.exportCompetitionReportCsv({ competitionCode: "missing" })
  ).toMatchObject({ ok: false, error: "invalid_input" });
});
