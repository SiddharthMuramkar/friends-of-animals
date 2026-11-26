// Leadership's cross-module report. Each measure uses its own persisted fact
// grain; a registration, donor, or respondent never leaves this aggregate seam.
import {
  and,
  count,
  countDistinct,
  eq,
  gte,
  lt,
  lte,
  ne,
  sum,
  or,
  isNotNull,
  notInArray,
  type AnyColumn,
} from "drizzle-orm";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  donation,
  refund,
  clubDecision,
  clubMembership,
  competition,
  engagementMilestone,
  event,
  eventRegistration,
  institution,
  registration,
  volunteerHoursEntry,
  volunteerTaskAssignment,
} from "../../db/schema";
import { MILESTONE_KINDS } from "../community/domain/milestones";
import type { UseCaseContext } from "../../use-cases";
import { formatMinorAsDecimal } from "../ledger/domain/journal";
import { surveyFeedbackMetrics } from "../surveys/results";
import {
  resolvePeriod,
  type ObjectivePeriodInput,
  type Period,
} from "./domain/period";
import { readSocialTrend, socialCsvRows } from "./social";
import { BOM, formatCsv } from "../registration/domain/csv";

// While status remains confirmed, updatedAt is its confirmation time. All
// later registration writes transition it away from confirmed. Cancelled
// competitions, withdrawn and refunded registrations are not participation.
async function participation(db: AppDb, period: Period) {
  const query = db
    .select({
      registrations: count(),
      participants: countDistinct(registration.participantProfileId),
    })
    .from(registration)
    .innerJoin(competition, eq(competition.id, registration.competitionId));
  const where = and(
    eq(registration.status, "confirmed"),
    ne(competition.status, "cancelled"),
    gte(registration.updatedAt, period.start),
    lt(registration.updatedAt, period.end)
  );
  const [total] = await query.where(where);
  const route = async (name: "institution" | "individual") => {
    const [row] = await db
      .select({
        registrations: count(),
        participants: countDistinct(registration.participantProfileId),
      })
      .from(registration)
      .innerJoin(competition, eq(competition.id, registration.competitionId))
      .where(and(where, eq(registration.route, name)));
    return row!;
  };
  const school = await route("institution");
  const individual = await route("individual");
  return {
    ...total!,
    institutionRegistrations: school.registrations,
    individualRegistrations: individual.registrations,
    institutionParticipants: school.participants,
    individualParticipants: individual.participants,
  };
}

// Institution code/verifiedAt survive suspensions; the report counts only
// currently verified partnerships whose original verification falls in range.
async function partnerships(db: AppDb, period: Period) {
  const rows = await db
    .select({ type: institution.type, n: count() })
    .from(institution)
    .where(
      and(
        eq(institution.status, "verified"),
        gte(institution.verifiedAt, period.start),
        lt(institution.verifiedAt, period.end)
      )
    )
    .groupBy(institution.type);
  const numberOf = (type: "school" | "college" | "other") =>
    rows.find((row) => row.type === type)?.n ?? 0;
  return {
    verifiedInstitutions: rows.reduce((n, row) => n + row.n, 0),
    verifiedSchools: numberOf("school"),
    verifiedColleges: numberOf("college"),
    verifiedOther: numberOf("other"),
  };
}

function during(column: AnyColumn, period: Period) {
  return and(gte(column, period.start), lt(column, period.end));
}

async function engagement(db: AppDb, period: Period) {
  const [milestones, clubs, memberships, events, checkIns] = await Promise.all([
    db
      .select({ kind: engagementMilestone.kind, n: count() })
      .from(engagementMilestone)
      .where(during(engagementMilestone.achievedAt, period))
      .groupBy(engagementMilestone.kind),
    db
      .select({ n: count() })
      .from(clubDecision)
      .where(
        and(
          eq(clubDecision.fromStatus, "applied"),
          eq(clubDecision.toStatus, "approved"),
          during(clubDecision.decidedAt, period)
        )
      ),
    db
      .select({ n: countDistinct(clubMembership.userId) })
      .from(clubMembership)
      .where(during(clubMembership.joinedAt, period)),
    db
      .select({ n: count() })
      .from(event)
      .where(
        and(eq(event.status, "completed"), during(event.startsAt, period))
      ),
    db
      .select({ n: count() })
      .from(eventRegistration)
      .where(
        and(
          eq(eventRegistration.status, "checked_in"),
          during(eventRegistration.checkedInAt, period)
        )
      ),
  ]);
  const ladder = Object.fromEntries(
    MILESTONE_KINDS.map((kind) => [
      kind,
      milestones.find((row) => row.kind === kind)?.n ?? 0,
    ])
  ) as Record<(typeof MILESTONE_KINDS)[number], number>;
  return {
    ...ladder,
    clubsApproved: clubs[0]!.n,
    clubMembersJoined: memberships[0]!.n,
    eventsHeld: events[0]!.n,
    eventCheckIns: checkIns[0]!.n,
  };
}

async function volunteers(db: AppDb, period: Period) {
  const [row] = await db
    .select({
      volunteers: countDistinct(volunteerTaskAssignment.volunteerUserId),
      approvedMinutes: sum(volunteerHoursEntry.minutes),
    })
    .from(volunteerHoursEntry)
    .innerJoin(
      volunteerTaskAssignment,
      eq(volunteerTaskAssignment.id, volunteerHoursEntry.assignmentId)
    )
    .where(
      and(
        eq(volunteerHoursEntry.status, "approved"),
        gte(volunteerHoursEntry.workedOn, period.from),
        lte(volunteerHoursEntry.workedOn, period.to)
      )
    );
  const approvedMinutes = Number(row?.approvedMinutes ?? 0);
  if (!Number.isSafeInteger(approvedMinutes))
    throw Error("Volunteer minutes exceed safe integer range");
  return { volunteers: row!.volunteers, approvedMinutes };
}

/** Same accepted capture predicate as ledger/sources/donations: an INR
 * donation with actual capturedAt and a gateway payment or offline method.
 * Cash flows are dated independently; a later refund does not erase the
 * original capture. Refused foreign/late recurring money and duplicate
 * review payments never contributed to income and do not reverse it. */
async function donations(db: AppDb, period: Period) {
  const accepted = and(
    eq(donation.currency, "INR"),
    isNotNull(donation.capturedAt),
    or(isNotNull(donation.gatewayPaymentId), isNotNull(donation.offlineMethod))
  );
  const [captured] = await db
    .select({ captures: count(), amount: sum(donation.amountMinor) })
    .from(donation)
    .where(and(accepted, during(donation.capturedAt, period)));
  const [returned] = await db
    .select({ amount: sum(refund.amountMinor) })
    .from(refund)
    .innerJoin(donation, eq(donation.paymentBatchId, refund.batchId))
    .where(
      and(
        accepted,
        eq(refund.status, "refunded"),
        eq(refund.currency, "INR"),
        notInArray(refund.kind, [
          "duplicate",
          "foreign_payment",
          "recurring_after_cancel",
        ]),
        or(
          ne(refund.method, "gateway"),
          eq(refund.gatewayPaymentId, donation.gatewayPaymentId)
        ),
        during(refund.refundedAt, period)
      )
    );
  const capturedMinor = BigInt(captured?.amount ?? 0);
  const refundedMinor = BigInt(returned?.amount ?? 0);
  return {
    captures: captured!.captures,
    capturedMinor,
    refundedMinor,
    netMinor: capturedMinor - refundedMinor,
  };
}

async function readObjectiveReport(db: AppDb, period: Period) {
  return {
    period: { from: period.from, to: period.to },
    participation: await participation(db, period),
    engagement: await engagement(db, period),
    partnerships: await partnerships(db, period),
    volunteers: await volunteers(db, period),
    donations: await donations(db, period),
    feedback: await surveyFeedbackMetrics(db, {
      from: period.start,
      to: period.end,
    }),
    social: await readSocialTrend(db, period),
  };
}
export type ObjectiveReport = Awaited<ReturnType<typeof readObjectiveReport>>;

export async function getObjectiveReport(
  ctx: UseCaseContext,
  input: ObjectivePeriodInput
) {
  return ctx.db.transaction(
    async (db) => {
      await authorize({ ...ctx, db }, "reports.objectives.read");
      const resolved = resolvePeriod(input);
      if (!resolved.ok) return resolved;
      return {
        ok: true,
        report: await readObjectiveReport(db, resolved.period),
      } as const;
    },
    { isolationLevel: "repeatable read" }
  );
}

/** One shared machine-readable table for display and export. All values
 * originate from aggregate SQL, not arbitrary labels or personal records. */
export const OBJECTIVE_CATEGORIES = [
  "participation",
  "engagement",
  "partnerships",
  "volunteers",
  "donations",
  "feedback",
] as const;
type Category = (typeof OBJECTIVE_CATEGORIES)[number];
type Metric = { [C in Category]: keyof ObjectiveReport[C] }[Category];
type CsvMetric =
  | Exclude<Metric, "capturedMinor" | "refundedMinor" | "netMinor">
  | "captured_inr"
  | "refunded_inr"
  | "net_inr";
export function objectiveRows(report: ObjectiveReport) {
  return OBJECTIVE_CATEGORIES.flatMap((category) =>
    Object.entries(report[category]).map(([metric, value]) => ({
      category,
      metric: (typeof value === "bigint"
        ? metric.replace("Minor", "_inr")
        : metric) as CsvMetric,
      value:
        typeof value === "bigint" ? formatMinorAsDecimal(value) : String(value),
    }))
  );
}

export async function exportObjectiveReportCsv(
  ctx: UseCaseContext,
  input: ObjectivePeriodInput
) {
  return ctx.db.transaction(
    async (db) => {
      const { role } = await authorize(
        { ...ctx, db },
        "reports.objectives.export"
      );
      const resolved = resolvePeriod(input);
      if (!resolved.ok) return resolved;
      const report = await readObjectiveReport(db, resolved.period);
      await recordAudit(db, ctx, {
        action: "reports.exported",
        entity: { type: "objective_report", id: "objectives" },
        before: null,
        after: {
          report: "objectives",
          format: "csv",
          from: report.period.from,
          to: report.period.to,
        },
        actorRole: role,
      });
      return {
        ok: true,
        filename: `foa-objectives-${report.period.from}-${report.period.to}.csv`,
        csv:
          BOM +
          formatCsv([
            ["from_ist", "to_ist"],
            [report.period.from, report.period.to],
            ["category", "metric", "value"],
            ...objectiveRows(report).map((row) => [
              row.category,
              row.metric,
              row.value,
            ]),
            [],
            ...socialCsvRows(report.social),
          ]),
      } as const;
    },
    { isolationLevel: "repeatable read" }
  );
}
