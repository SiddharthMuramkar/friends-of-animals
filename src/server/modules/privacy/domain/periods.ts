// How long each timed retention policy keeps its records by default (#114),
// and the floors no setting can shorten. Each policy here has one runtime
// setting, `retention.<policy>Days` in #62's catalogue, so a super admin
// changes a period without a deploy; the catalogue reads its default and
// its minimum from here. Every period waits for counsel (HR-31); the
// financial floor waits for the accountant too (HR-47).
//
// Pure, and loads under plain Node (the seed script reads the catalogue).

import { minimumFloorDays, type LegalFloor } from "./retention-period";

export type RetentionPeriod = {
  /** The setting's default, in days. */
  defaultDays: number;
  /** A minimum keeping time that settings can't shorten. */
  floor?: LegalFloor;
};

/** Financial records: 8 years after the end of their financial year. */
export const FINANCIAL_FLOOR: LegalFloor = {
  kind: "financial_years",
  years: 8,
};

export const RETENTION_PERIODS = {
  /** Local and preview message captures, from when they were captured. */
  capturedMessages: { defaultDays: 30 },
  /** Sign-in codes and links, from when they expired. */
  expiredVerifications: { defaultDays: 1 },
  /** Sessions (with their IP address and browser), from when they expired. */
  expiredSessions: { defaultDays: 30 },
  /** The log of each message sent, from when it was queued. */
  messageDeliveries: { defaultDays: 365 },
  /** In-app messages, from when the person read them. */
  readInboxItems: { defaultDays: 365 },
  /** Files flagged by the scanner, from when they were quarantined. */
  quarantinedFiles: { defaultDays: 30 },
  /** Delivered background jobs (their payloads hold ids), from delivery. */
  dispatchedOutbox: { defaultDays: 30 },
  /** An expired coordinator invitation's link, from when it expired. */
  coordinatorInvitationLinks: { defaultDays: 1 },
  /** An expired guardian invitation's link, from when it expired. */
  guardianInvitationLinks: { defaultDays: 1 },
  /** Coordinator invitations, from when they were accepted, withdrawn or expired. */
  coordinatorInvitations: { defaultDays: 90 },
  /** Teen-login invitations and guardian requests, from when they closed. */
  guardianInvitations: { defaultDays: 30 },
  /**
   * Volunteer applications that closed without approval (#123): declined,
   * withdrawn, or declined by the guardian, from when they closed.
   */
  volunteerApplications: { defaultDays: 365 },
  /** Declined ambassador applications, from decision. */
  ambassadorApplications: { defaultDays: 365 },
  /** Former member profile text, from departure. */
  surveyResponses: { defaultDays: 365 },
  communityMembers: { defaultDays: 365 },
  clubMemberships: { defaultDays: 730 },
  clubApplications: { defaultDays: 730 },
  /**
   * Adoption applications (#130), from when they closed; one behind a
   * published success story stays while the story is up.
   */
  adoptionApplications: { defaultDays: 730 },
  /** Legal holds, from when they were released. */
  releasedLegalHolds: { defaultDays: 365 },
  /** Privacy rights requests and their notes, from when they closed (#115). */
  privacyRequests: { defaultDays: 1095 },
  /** Payments, refunds and their reviews: the floor decides in practice. */
  financialRecords: {
    defaultDays: minimumFloorDays(FINANCIAL_FLOOR),
    floor: FINANCIAL_FLOOR,
  },
} as const satisfies Record<string, RetentionPeriod>;

export type TimedPolicyKey = keyof typeof RETENTION_PERIODS;

/** Contact messages expire by calendar months after closure (HR-31). */
export const CONTACT_RETENTION = {
  settingKey: "retention.contactMessagesMonths",
  defaultMonths: 24,
  minimumMonths: 1,
  maximumMonths: 240,
} as const;

/** The longest period a setting accepts: 20 years. */
export const MAX_RETENTION_DAYS = 7305;

/** The lowest value the policy's setting accepts. */
export function minimumRetentionDays(period: RetentionPeriod): number {
  return minimumFloorDays(period.floor);
}

/** The setting that holds a timed policy's period. */
export function retentionSettingKey<K extends TimedPolicyKey>(
  key: K
): `retention.${K}Days` {
  return `retention.${key}Days`;
}
