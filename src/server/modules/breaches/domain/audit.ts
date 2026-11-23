// What a breach's audit rows may say (#116). The audit log is append-only
// and outlives the breach record, so `before` and `after` carry the
// record's lifecycle fields, flags and counts only: never its title, the
// impact text, a timeline note, who was affected, or the authority's
// reference. Use cases build the JSON with the snapshot below, which parses
// it with a strict schema before it is written.
//
// Pure, and loads under plain Node.

import { z } from "zod";

import {
  BREACH_SEVERITIES,
  BREACH_STATUSES,
  BREACH_UPDATABLE_FIELDS,
  type BreachSeverity,
  type BreachStatus,
  type BreachUpdatableField,
} from "./breach-status";

/** The audit `action` of each breach use case. */
export const BREACH_AUDIT_ACTIONS = [
  "breach.recorded",
  "breach.updated",
  "breach.timeline_entry_added",
  "breach.contained",
  "breach.fan_out_requested",
  "breach.principal_notices_queued",
  "breach.principal_notices_requeued",
  "breach.principals_notified",
  "breach.principal_notice_delivered",
  "breach.principal_notice_scope_updated",
  "breach.principal_notice_reach_updated",
  "breach.fan_out_completed",
  "breach.authority_email_queued",
  "breach.authority_email_requeued",
  "breach.authority_notified",
  "breach.closed",
] as const;

export type BreachAuditAction = (typeof BREACH_AUDIT_ACTIONS)[number];

const instant = z.iso.datetime().nullable();
const reachGapCounts = z.strictObject({
  no_guardian: z.int().min(0),
  no_account: z.int().min(0),
});
export type ReachGapCounts = z.infer<typeof reachGapCounts>;

export const breachAuditSchema = z.strictObject({
  status: z.enum(BREACH_STATUSES),
  severity: z.enum(BREACH_SEVERITIES),
  personalDataInvolved: z.boolean(),
  minorsAffected: z.boolean(),
  affectedCount: z.int().min(0),
  containedAt: instant,
  principalsNotifiedAt: instant,
  authorityNotifiedAt: instant,
  /** How many notices went out in this change; never to whom. */
  noticesSent: z.int().min(0).optional(),
  noticesQueued: z.int().min(0).optional(),
  eventsRequeued: z.int().min(0).optional(),
  reachGapsAdded: reachGapCounts.optional(),
  reachGapsCleared: reachGapCounts.optional(),
  /** The names of the fields a correction changed; never their values. */
  changedFields: z.array(z.enum(BREACH_UPDATABLE_FIELDS)).optional(),
});

export type BreachAudit = z.infer<typeof breachAuditSchema>;

/** The breach fields a snapshot reads. Extra fields are ignored. */
export type AuditableBreach = {
  status: BreachStatus;
  severity: BreachSeverity;
  personalDataInvolved: boolean;
  minorsAffected: boolean;
  affectedCount: number;
  containedAt: Date | null;
  principalsNotifiedAt: Date | null;
  authorityNotifiedAt: Date | null;
};

const iso = (at: Date | null) => (at === null ? null : at.toISOString());

/** A breach as its audit rows may show it. */
export function breachAuditSnapshot(
  breach: AuditableBreach,
  extra: Pick<
    BreachAudit,
    | "noticesSent"
    | "noticesQueued"
    | "eventsRequeued"
    | "reachGapsAdded"
    | "reachGapsCleared"
  > & {
    changedFields?: readonly BreachUpdatableField[];
  } = {}
): BreachAudit {
  return breachAuditSchema.parse({
    status: breach.status,
    severity: breach.severity,
    personalDataInvolved: breach.personalDataInvolved,
    minorsAffected: breach.minorsAffected,
    affectedCount: breach.affectedCount,
    containedAt: iso(breach.containedAt),
    principalsNotifiedAt: iso(breach.principalsNotifiedAt),
    authorityNotifiedAt: iso(breach.authorityNotifiedAt),
    ...(extra.noticesSent === undefined
      ? {}
      : { noticesSent: extra.noticesSent }),
    ...(extra.noticesQueued === undefined
      ? {}
      : { noticesQueued: extra.noticesQueued }),
    ...(extra.eventsRequeued === undefined
      ? {}
      : { eventsRequeued: extra.eventsRequeued }),
    ...(extra.reachGapsAdded === undefined
      ? {}
      : { reachGapsAdded: extra.reachGapsAdded }),
    ...(extra.reachGapsCleared === undefined
      ? {}
      : { reachGapsCleared: extra.reachGapsCleared }),
    ...(extra.changedFields === undefined
      ? {}
      : { changedFields: [...extra.changedFields] }),
  });
}
