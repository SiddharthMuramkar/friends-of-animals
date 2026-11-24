// What one retention policy does to its candidate rows in one run (#114).
// The engine loads rows whose anchor is past the policy's cutoff, the
// subjects each row belongs to and the active legal holds; this decides,
// row by row, whether the policy's action applies, and counts the outcome
// for the run's audit row. Counts are the only thing a run records: never
// ids, names or addresses.
//
// Pure, and loads under plain Node: the worker's schedule runs it.

import { z } from "zod";

import { isExpired, type LegalFloor } from "./retention-period";

/** Who a row is about, as a legal hold names them. */
export type SubjectRef = {
  /** e.g. "user", "participant_profile", "institution". */
  type: string;
  id: string;
};

export type RetentionCandidate = {
  id: string;
  /** The instant the policy measures the period from. */
  anchor: Date;
  /** Everyone the row is about; a hold on any of them keeps it. */
  subjects: readonly SubjectRef[];
};

/** A hold in force: placed and not released. */
export type ActiveLegalHold = { subjectType: string; subjectId: string };

export type RetentionAction = "delete" | "anonymise";

/** A policy as one run applies it, with its period read from settings. */
export type PolicyRun = {
  key: string;
  action: RetentionAction;
  /** The retention setting's value, in days. */
  days: number;
  floor?: LegalFloor | undefined;
};

export type PolicyCounts = {
  deleted: number;
  anonymised: number;
  /** Expired, but a subject is on legal hold. */
  held: number;
  /** Past the setting's period, but still inside the statutory floor. */
  retainedByFloor: number;
};

export type RetentionPlan = {
  /** Rows to delete or anonymise, in candidate order. */
  apply: string[];
  counts: PolicyCounts;
};

function holdKey(type: string, id: string): string {
  return `${type}\u0000${id}`;
}

/**
 * Decides each candidate: a row whose period isn't over is left alone and
 * not counted; an expired row is held if any subject is on hold, kept if
 * its floor still protects it, and otherwise gets the policy's action.
 * A hold wins over a floor in the counts, so lifting the hold explains
 * what happens next.
 */
export function planRetention(input: {
  now: Date;
  policy: PolicyRun;
  candidates: readonly RetentionCandidate[];
  holds: readonly ActiveLegalHold[];
}): RetentionPlan {
  const { now, policy } = input;
  const held = new Set(
    input.holds.map((hold) => holdKey(hold.subjectType, hold.subjectId))
  );
  const plan: RetentionPlan = {
    apply: [],
    counts: { deleted: 0, anonymised: 0, held: 0, retainedByFloor: 0 },
  };
  for (const row of input.candidates) {
    if (!isExpired({ anchor: row.anchor, now, days: policy.days })) continue;
    if (
      row.subjects.some((subject) =>
        held.has(holdKey(subject.type, subject.id))
      )
    ) {
      plan.counts.held += 1;
    } else if (
      !isExpired({
        anchor: row.anchor,
        now,
        days: policy.days,
        floor: policy.floor,
      })
    ) {
      plan.counts.retainedByFloor += 1;
    } else {
      plan.apply.push(row.id);
      if (policy.action === "delete") plan.counts.deleted += 1;
      else plan.counts.anonymised += 1;
    }
  }
  return plan;
}

const count = z.int().min(0);

/** Policy keys are camelCase names, never data. */
const policyKey = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]{0,63}$/, "A policy key is a camelCase name");

/**
 * The only shape a retention run's audit `after` may take. The use case
 * parses with it before writing, so ids or personal data can't slip in.
 */
export const retentionRunAuditSchema = z.strictObject({
  dryRun: z.boolean(),
  policies: z.record(
    policyKey,
    z.strictObject({
      deleted: count,
      anonymised: count,
      held: count,
      retainedByFloor: count,
    })
  ),
});

export type RetentionRunSummary = z.infer<typeof retentionRunAuditSchema>;

/** The audit `after` for one run (or dry run): counts per policy. */
export function retentionRunSummary(input: {
  dryRun: boolean;
  policies: Readonly<Record<string, PolicyCounts>>;
}): RetentionRunSummary {
  return retentionRunAuditSchema.parse({
    dryRun: input.dryRun,
    policies: Object.fromEntries(
      Object.entries(input.policies).map(([key, counts]) => [
        key,
        {
          deleted: counts.deleted,
          anonymised: counts.anonymised,
          held: counts.held,
          retainedByFloor: counts.retainedByFloor,
        },
      ])
    ),
  });
}
