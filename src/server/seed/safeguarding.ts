// Safeguarding seed data (#116): a safeguarding lead, and three reports a
// preview's lead queue can show: one new, one under investigation with a
// note, one resolved. Ids are fixed, so seeding again changes nothing, and
// the text is plainly made up. Seed data writes no audit rows. Loads under
// plain Node (the seed script): relative imports only, no "server-only".

import { safeguardingIncidentLog, safeguardingReport } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { seal, sealOrNull } from "../modules/safeguarding/content";
import type { Concern } from "../modules/safeguarding/domain/concern";
import type {
  IncidentLogKind,
  SafeguardingReportStatus,
  SafeguardingSeverity,
} from "../modules/safeguarding/domain/report-status";
import { ensureGrant } from "./access";
import type { SeedDeps } from "./types";

/** The designated safeguarding lead every preview has (HR-17). */
export const SEED_SAFEGUARDING_LEAD = {
  id: "01938a00-0000-7000-8000-000000000116",
  name: "Seed Safeguarding Lead",
  email: "dsl@example.test",
} as const;

export type ReportSeed = {
  id: string;
  reference: string;
  concern: Concern;
  createdAt: Date;
  status?: SafeguardingReportStatus;
  severity?: SafeguardingSeverity | null;
  assignedToUserId?: string | null;
  escalationReference?: string | null;
  outcome?: string | null;
  resolvedAt?: Date | null;
};

/** Stores a report as the form would, unless one has its id already. */
export async function ensureSafeguardingReport(
  { db, cipher }: SeedDeps,
  seed: ReportSeed
): Promise<void> {
  const { concern } = seed;
  await db
    .insert(safeguardingReport)
    .values({
      id: seed.id,
      reference: seed.reference,
      category: concern.category,
      description: seal(cipher, "description", concern.description),
      subjectDetails: sealOrNull(
        cipher,
        "subjectDetails",
        concern.subjectDetails
      ),
      subjectAge: concern.subjectAge,
      reporterIsChild: concern.reporterIsChild,
      anonymous: concern.anonymous,
      reporterName: sealOrNull(cipher, "reporterName", concern.reporterName),
      reporterContact: sealOrNull(
        cipher,
        "reporterContact",
        concern.reporterContact
      ),
      status: seed.status ?? "new",
      severity: seed.severity ?? null,
      assignedToUserId: seed.assignedToUserId ?? null,
      escalationReference: sealOrNull(
        cipher,
        "escalationReference",
        seed.escalationReference ?? null
      ),
      outcome: sealOrNull(cipher, "outcome", seed.outcome ?? null),
      createdAt: seed.createdAt,
      updatedAt: seed.resolvedAt ?? seed.createdAt,
      resolvedAt: seed.resolvedAt ?? null,
    })
    .onConflictDoNothing();
}

export type LogEntrySeed = {
  id: string;
  reportId: string;
  kind: IncidentLogKind;
  toStatus?: SafeguardingReportStatus | null;
  severity?: SafeguardingSeverity | null;
  body?: string | null;
  authorUserId: string | null;
  createdAt: Date;
};

/** Appends an incident log entry unless one has its id already. */
export async function ensureIncidentLogEntry(
  { db, cipher }: SeedDeps,
  seed: LogEntrySeed
): Promise<void> {
  await db
    .insert(safeguardingIncidentLog)
    .values({
      id: seed.id,
      reportId: seed.reportId,
      kind: seed.kind,
      toStatus: seed.toStatus ?? null,
      severity: seed.severity ?? null,
      body: sealOrNull(cipher, "logBody", seed.body ?? null),
      authorUserId: seed.authorUserId,
      createdAt: seed.createdAt,
    })
    .onConflictDoNothing();
}

const day = (iso: string) => new Date(`${iso}T09:30:00+05:30`);

/** The preview's reports; ids are fixed so a second run adds nothing. */
export const SEED_SAFEGUARDING_REPORTS = {
  fresh: "01938a00-0000-7000-8000-00000000f161",
  investigating: "01938a00-0000-7000-8000-00000000f162",
  resolved: "01938a00-0000-7000-8000-00000000f163",
} as const;

/** The lead, granted globally, and the three reports with their logs. */
export async function seedSafeguarding(deps: SeedDeps): Promise<void> {
  const lead = await ensureVerifiedAccount(deps, SEED_SAFEGUARDING_LEAD);
  await ensureGrant(deps, lead.id, {
    role: "safeguarding_lead",
    scope: { type: "global" },
  });
  // Made-up text only: previews are not for real reports.
  await ensureSafeguardingReport(deps, {
    id: SEED_SAFEGUARDING_REPORTS.fresh,
    reference: "SG-26-SEED01",
    createdAt: day("2026-11-02"),
    concern: {
      category: "inappropriate_contact",
      description:
        "Sample report: an adult account kept messaging a student " +
        "after a sample competition.",
      subjectDetails: "Sample School, Class 7",
      subjectAge: 12,
      reporterIsChild: false,
      anonymous: true,
      reporterName: null,
      reporterContact: null,
    },
  });

  const investigating = SEED_SAFEGUARDING_REPORTS.investigating;
  await ensureSafeguardingReport(deps, {
    id: investigating,
    reference: "SG-26-SEED02",
    createdAt: day("2026-10-20"),
    status: "investigating",
    severity: "high",
    assignedToUserId: lead.id,
    concern: {
      category: "privacy_exposure",
      description:
        "Sample report: a photo with a student's full name and school " +
        "was posted on a sample page.",
      subjectDetails: null,
      subjectAge: 15,
      reporterIsChild: true,
      anonymous: false,
      reporterName: "Sample Reporter",
      reporterContact: "sample-reporter@example.test",
    },
  });
  await ensureIncidentLogEntry(deps, {
    id: "01938a00-0000-7000-8000-00000000f171",
    reportId: investigating,
    kind: "status_change",
    toStatus: "triaged",
    severity: "high",
    authorUserId: lead.id,
    createdAt: day("2026-10-20"),
  });
  await ensureIncidentLogEntry(deps, {
    id: "01938a00-0000-7000-8000-00000000f172",
    reportId: investigating,
    kind: "status_change",
    toStatus: "investigating",
    authorUserId: lead.id,
    createdAt: day("2026-10-21"),
  });
  await ensureIncidentLogEntry(deps, {
    id: "01938a00-0000-7000-8000-00000000f173",
    reportId: investigating,
    kind: "note",
    body: "Sample note: asked the page owner to take the photo down.",
    authorUserId: lead.id,
    createdAt: day("2026-10-21"),
  });

  const resolved = SEED_SAFEGUARDING_REPORTS.resolved;
  await ensureSafeguardingReport(deps, {
    id: resolved,
    reference: "SG-26-SEED03",
    createdAt: day("2026-09-10"),
    status: "resolved",
    severity: "low",
    assignedToUserId: lead.id,
    outcome: "Sample outcome: no action needed; the reporter was thanked.",
    resolvedAt: day("2026-09-12"),
    concern: {
      category: "bullying",
      description: "Sample report: unkind comments under a sample showcase.",
      subjectDetails: null,
      subjectAge: null,
      reporterIsChild: false,
      anonymous: true,
      reporterName: null,
      reporterContact: null,
    },
  });
  await ensureIncidentLogEntry(deps, {
    id: "01938a00-0000-7000-8000-00000000f174",
    reportId: resolved,
    kind: "status_change",
    toStatus: "triaged",
    severity: "low",
    authorUserId: lead.id,
    createdAt: day("2026-09-11"),
  });
  await ensureIncidentLogEntry(deps, {
    id: "01938a00-0000-7000-8000-00000000f175",
    reportId: resolved,
    kind: "status_change",
    toStatus: "resolved",
    body: "Sample outcome: no action needed; the reporter was thanked.",
    authorUserId: lead.id,
    createdAt: day("2026-09-12"),
  });
}
