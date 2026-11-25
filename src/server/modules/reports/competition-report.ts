import {
  and,
  asc,
  count,
  eq,
  isNotNull,
  inArray,
  ne,
  notInArray,
} from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  certificate,
  competition,
  competitionAgeGroup,
  entry,
  paymentBatch,
  refund,
  registration,
  schoolRoundPick,
} from "../../db/schema";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { eligibleCapture, readCapture } from "../ledger/sources/payments";
import { formatMinorAsDecimal } from "../ledger/domain/journal";
import { BOM, formatCsv, neutraliseFormula } from "../registration/domain/csv";
import {
  REGISTRATION_ROUTES,
  type RegistrationRoute,
} from "../registration/domain/participant";
import { competitionResource, reportScope } from "./scope";

export const REPORT_METRICS = [
  "registrations",
  "entries",
  "shortlisted",
  "verified",
  "certificates",
] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];
export type MetricTotals = Record<
  Exclude<ReportMetric, "shortlisted">,
  number
> & { shortlisted: number | null };
export type ReportRow = MetricTotals & {
  route: RegistrationRoute;
  ageGroupId: string;
  ageGroupLabel: string;
};
export type FeeTotals = {
  capturedMinor: bigint;
  refundedMinor: bigint;
  netMinor: bigint;
};
export type ReportCompetition = { id: string; code: string; name: string };

export type CompetitionReport = {
  competition: ReportCompetition;
  rows: ReportRow[];
  routeTotals: { route: RegistrationRoute; totals: MetricTotals }[];
  ageGroupTotals: {
    ageGroupId: string;
    ageGroupLabel: string;
    totals: MetricTotals;
  }[];
  total: MetricTotals;
  fees: {
    routes: { route: RegistrationRoute; totals: FeeTotals }[];
    total: FeeTotals;
    currency: "INR";
  };
};

export type CountFact = {
  route: RegistrationRoute;
  ageGroupId: string;
  count: number;
  metric: ReportMetric;
};
export type AgeGroup = { id: string; label: string };

function totals(rows: MetricTotals[]): MetricTotals {
  return {
    registrations: rows.reduce((sum, r) => sum + r.registrations, 0),
    entries: rows.reduce((sum, r) => sum + r.entries, 0),
    shortlisted: rows.some((r) => r.shortlisted !== null)
      ? rows.reduce((sum, r) => sum + (r.shortlisted ?? 0), 0)
      : null,
    verified: rows.reduce((sum, r) => sum + r.verified, 0),
    certificates: rows.reduce((sum, r) => sum + r.certificates, 0),
  };
}

export function buildReportCounts(groups: AgeGroup[], facts: CountFact[]) {
  const rows = REGISTRATION_ROUTES.flatMap((route) =>
    groups.map(
      (group) =>
        ({
          route,
          ageGroupId: group.id,
          ageGroupLabel: group.label,
          registrations: 0,
          entries: 0,
          shortlisted: route === "institution" ? 0 : null,
          verified: 0,
          certificates: 0,
        }) satisfies ReportRow
    )
  );
  const byKey = new Map<string, ReportRow>(
    rows.map((row) => [`${row.route}:${row.ageGroupId}`, row])
  );
  for (const fact of facts) {
    const row = byKey.get(`${fact.route}:${fact.ageGroupId}`);
    if (
      !row ||
      row[fact.metric] === null ||
      !Number.isSafeInteger(fact.count) ||
      fact.count < 0
    )
      throw new Error("Invalid competition report count");
    row[fact.metric] += fact.count;
  }
  return {
    rows,
    routeTotals: REGISTRATION_ROUTES.map((route) => ({
      route,
      totals: {
        ...totals(rows.filter((r) => r.route === route)),
        shortlisted:
          route === "institution"
            ? rows
                .filter((r) => r.route === route)
                .reduce((n, r) => n + (r.shortlisted ?? 0), 0)
            : null,
      },
    })),
    ageGroupTotals: groups.map((group) => ({
      ageGroupId: group.id,
      ageGroupLabel: group.label,
      totals: totals(rows.filter((r) => r.ageGroupId === group.id)),
    })),
    total: {
      ...totals(rows),
      shortlisted: rows.reduce((sum, r) => sum + (r.shortlisted ?? 0), 0),
    },
  };
}

const countColumns = {
  route: registration.route,
  ageGroupId: registration.ageGroupId,
  count: count(),
};
const axes = [registration.route, registration.ageGroupId] as const;

/**
 * Aggregate each fact grain separately. Neither certificate multiplicity nor
 * entry files, batch items or refund items are allowed to multiply counts.
 * School picks represent the current shortlist (individual route is N/A).
 */
export async function readReportCounts(
  db: AppDb,
  competitionId: string
): Promise<CountFact[]> {
  const inCompetition = eq(registration.competitionId, competitionId);
  const registered = await db
    .select(countColumns)
    .from(registration)
    .where(and(inCompetition, eq(registration.status, "confirmed")))
    .groupBy(...axes);
  const entries = await db
    .select(countColumns)
    .from(registration)
    .innerJoin(entry, eq(entry.registrationId, registration.id))
    .where(
      and(
        inCompetition,
        eq(entry.competitionId, competitionId),
        notInArray(entry.status, ["processing", "rejected", "failed"]),
        isNotNull(entry.submittedAt)
      )
    )
    .groupBy(...axes);
  const shortlisted = await db
    .select(countColumns)
    .from(registration)
    .innerJoin(entry, eq(entry.registrationId, registration.id))
    .innerJoin(schoolRoundPick, eq(schoolRoundPick.entryId, entry.id))
    .where(
      and(
        inCompetition,
        eq(entry.competitionId, competitionId),
        eq(registration.route, "institution")
      )
    )
    .groupBy(...axes);
  const verified = await db
    .select(countColumns)
    .from(registration)
    .innerJoin(entry, eq(entry.registrationId, registration.id))
    .where(
      and(
        inCompetition,
        eq(entry.competitionId, competitionId),
        eq(entry.status, "foa_verified")
      )
    )
    .groupBy(...axes);
  const certificates = await db
    .select(countColumns)
    .from(registration)
    .innerJoin(certificate, eq(certificate.registrationId, registration.id))
    .where(
      and(
        inCompetition,
        eq(certificate.competitionId, competitionId),
        eq(certificate.status, "issued")
      )
    )
    .groupBy(...axes);
  return [
    ...registered.map((row) => ({ ...row, metric: "registrations" as const })),
    ...entries.map((row) => ({ ...row, metric: "entries" as const })),
    ...shortlisted.map((row) => ({ ...row, metric: "shortlisted" as const })),
    ...verified.map((row) => ({ ...row, metric: "verified" as const })),
    ...certificates.map((row) => ({ ...row, metric: "certificates" as const })),
  ];
}

function emptyFees(): FeeTotals {
  return { capturedMinor: 0n, refundedMinor: 0n, netMinor: 0n };
}

/** Fee revenue uses the same accepted-capture and duplicate-refund semantics
 * as ledger sources. Read each batch once: a batch can fund many registrations.
 */
export async function readReportFees(
  db: AppDb,
  competitionId: string
): Promise<CompetitionReport["fees"]> {
  const totalsByRoute = { institution: emptyFees(), individual: emptyFees() };
  const batches = await db
    .select({ id: paymentBatch.id, route: paymentBatch.route })
    .from(paymentBatch)
    .where(
      and(eq(paymentBatch.competitionId, competitionId), eligibleCapture(db))
    );
  for (const batch of batches) {
    if (!batch.route) throw new Error("Fee batch has no route");
    const capture = await readCapture(db, batch.id);
    if (capture)
      totalsByRoute[batch.route].capturedMinor += capture.amountMinor;
  }
  const refunds = await db
    .select({ route: paymentBatch.route, amountMinor: refund.amountMinor })
    .from(refund)
    .innerJoin(paymentBatch, eq(paymentBatch.id, refund.batchId))
    .where(
      and(
        eq(paymentBatch.competitionId, competitionId),
        eq(paymentBatch.purpose, "registration_fee"),
        eq(refund.status, "refunded"),
        ne(refund.kind, "duplicate")
      )
    );
  for (const row of refunds) {
    if (!row.route) throw new Error("Fee refund has no route");
    totalsByRoute[row.route].refundedMinor += row.amountMinor;
  }
  const total = emptyFees();
  const routes = REGISTRATION_ROUTES.map((route) => {
    const totals = totalsByRoute[route];
    totals.netMinor = totals.capturedMinor - totals.refundedMinor;
    total.capturedMinor += totals.capturedMinor;
    total.refundedMinor += totals.refundedMinor;
    total.netMinor += totals.netMinor;
    return { route, totals };
  });
  return { routes, total, currency: "INR" };
}

const competitionColumns = {
  id: competition.id,
  code: competition.code,
  name: competition.name,
};
const reportInput = z.object({
  competitionCode: z.string().regex(/^[A-Z]{3,6}\d{2}$/),
});
export type CompetitionReportInput = z.input<typeof reportInput>;

export async function listReportCompetitions(ctx: UseCaseContext) {
  const scope = await reportScope(ctx, "reports.competition.read");
  if (scope !== "all" && scope.length === 0)
    await authorize(ctx, "reports.competition.read");
  return ctx.db
    .select(competitionColumns)
    .from(competition)
    .where(scope === "all" ? undefined : inArray(competition.id, [...scope]))
    .orderBy(asc(competition.name), asc(competition.code));
}

async function readReport(
  ctx: UseCaseContext,
  input: CompetitionReportInput,
  exporting: boolean
) {
  // Check eligibility before looking up a user-provided identifier.
  const action = exporting
    ? "reports.competition.export"
    : "reports.competition.read";
  const scope = await reportScope(ctx, action);
  if (scope !== "all" && scope.length === 0) await authorize(ctx, action);
  const parsed = reportInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const [comp] = await ctx.db
    .select(competitionColumns)
    .from(competition)
    .where(eq(competition.code, parsed.data.competitionCode));
  if (!comp) return { ok: false, error: "not_found" } as const;
  const { role } = await authorize(ctx, action, competitionResource(comp.id));
  const ageGroups = await ctx.db
    .select({ id: competitionAgeGroup.id, label: competitionAgeGroup.label })
    .from(competitionAgeGroup)
    .where(eq(competitionAgeGroup.competitionId, comp.id))
    .orderBy(asc(competitionAgeGroup.position));
  const counts = await readReportCounts(ctx.db, comp.id);
  const fees = await readReportFees(ctx.db, comp.id);
  const report: CompetitionReport = {
    competition: comp,
    ...buildReportCounts(ageGroups, counts),
    fees,
  };
  return { ok: true, report, role } as const;
}

export async function getCompetitionReport(
  ctx: UseCaseContext,
  input: CompetitionReportInput
) {
  return ctx.db.transaction(
    async (db) => {
      const result = await readReport({ ...ctx, db }, input, false);
      if (!result.ok) return result;
      return { ok: true, report: result.report } as const;
    },
    { isolationLevel: "repeatable read" }
  );
}

const metricsAsCells = (row: MetricTotals) =>
  REPORT_METRICS.map((metric) =>
    row[metric] === null ? "" : String(row[metric])
  );
const feeAsCells = (row: FeeTotals) =>
  [row.capturedMinor, row.refundedMinor, row.netMinor].map(
    formatMinorAsDecimal
  );

/** Stable machine-readable CSV labels; same aggregate rows as the HTML view.
 * Only the text labels can contain user-provided content, and these alone
 * are neutralised so signed amounts stay numeric spreadsheet cells.
 */
function competitionCsv(report: CompetitionReport) {
  return (
    BOM +
    formatCsv([
      [
        "competition",
        report.competition.code,
        neutraliseFormula(report.competition.name),
      ],
      ["route", "age_group", ...REPORT_METRICS],
      ...report.rows.map((row) => [
        row.route,
        neutraliseFormula(row.ageGroupLabel),
        ...metricsAsCells(row),
      ]),
      ...report.routeTotals.map((row) => [
        row.route,
        "total",
        ...metricsAsCells(row.totals),
      ]),
      ...report.ageGroupTotals.map((row) => [
        "all",
        neutraliseFormula(row.ageGroupLabel),
        ...metricsAsCells(row.totals),
      ]),
      ["all", "total", ...metricsAsCells(report.total)],
      [],
      ["route", "captured_inr", "refunded_inr", "net_inr"],
      ...report.fees.routes.map((row) => [
        row.route,
        ...feeAsCells(row.totals),
      ]),
      ["all", ...feeAsCells(report.fees.total)],
    ])
  );
}

export async function exportCompetitionReportCsv(
  ctx: UseCaseContext,
  input: CompetitionReportInput
) {
  return ctx.db.transaction(
    async (db) => {
      const result = await readReport({ ...ctx, db }, input, true);
      if (!result.ok) return result;
      await recordAudit(db, ctx, {
        action: "reports.exported",
        entity: { type: "competition", id: result.report.competition.id },
        before: null,
        after: { report: "competition", format: "csv" },
        actorRole: result.role,
      });
      return {
        ok: true,
        csv: competitionCsv(result.report),
        filename: `foa-competition-${result.report.competition.code}.csv`,
      } as const;
    },
    { isolationLevel: "repeatable read" }
  );
}
