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
  type AnyColumn,
} from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
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
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { istDateRange } from "../ledger/domain/period";
import { BOM, formatCsv } from "../registration/domain/csv";

const periodInput = z
  .strictObject({ from: z.iso.date(), to: z.iso.date() })
  .refine(({ from, to }) => istDateRange({ from, to }).ok, {
    path: ["to"],
    message: "invalid_date_range",
  });
export type ObjectivePeriodInput = z.input<typeof periodInput>;
type Period = ObjectivePeriodInput & { start: Date; end: Date };

function resolvePeriod(input: ObjectivePeriodInput) {
  const parsed = periodInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { from, to } = parsed.data;
  const range = istDateRange({ from, to });
  if (!range.ok || !range.fromInclusive || !range.toExclusive)
    throw Error("Invalid validated period");
  return {
    ok: true,
    period: { from, to, start: range.fromInclusive, end: range.toExclusive },
  } as const;
}

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

async function readObjectiveReport(db: AppDb, period: Period) {
  return {
    period: { from: period.from, to: period.to },
    participation: await participation(db, period),
    engagement: await engagement(db, period),
    partnerships: await partnerships(db, period),
    volunteers: await volunteers(db, period),
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
export function objectiveRows(report: ObjectiveReport) {
  return (
    ["participation", "engagement", "partnerships", "volunteers"] as const
  ).flatMap((category) =>
    Object.entries(report[category]).map(([metric, value]) => ({
      category,
      metric,
      value: String(value),
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
          ]),
      } as const;
    },
    { isolationLevel: "repeatable read" }
  );
}
