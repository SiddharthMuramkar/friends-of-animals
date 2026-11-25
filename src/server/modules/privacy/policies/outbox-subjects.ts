import { inArray, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import type { AppDb } from "../../../db/app-db";
import {
  campaignRecipient,
  communityMember,
  event,
  eventRegistration,
  engagementMilestone,
  cmsPost,
  competition,
  consentEvent,
  contactMessage,
  fileAsset,
  guardian,
  guardianInvitation,
  institutionInvitation,
  institutionRegistration,
  outbox,
  paymentBatch,
  refund,
  registration,
  rubric,
  safeguardingReport,
  user,
  type OutboxRow,
} from "../../../db/schema";
import {
  EVENT_PAYLOADS,
  parseStoredEventPayload,
  type DomainEvent,
  type EventType,
} from "../../../outbox/events";
import type { SubjectRef } from "../domain/retention-plan";
import { subjectsOf, subjectSelection, type SubjectColumn } from "./define";

type AggregateSource = {
  table: PgTable & { id: PgColumn };
  subjects: readonly SubjectColumn[];
};

// The aggregate links that identify people or institutions in the event.
// Read them in batches alongside payload subjects, which can outlive the links.
const aggregateSources = {
  event: { table: event, subjects: [["user", event.createdByUserId]] },
  event_registration: {
    table: eventRegistration,
    subjects: [
      ["user", eventRegistration.subjectUserId],
      ["participant_profile", eventRegistration.subjectProfileId],
      ["user", eventRegistration.registeredByUserId],
      ["user", eventRegistration.checkedInByUserId],
    ],
  },
  community_member: {
    table: communityMember,
    subjects: [
      ["user", communityMember.subjectUserId],
      ["participant_profile", communityMember.subjectProfileId],
      ["user", communityMember.joinedByUserId],
    ],
  },
  engagement_milestone: {
    table: engagementMilestone,
    subjects: [
      ["user", engagementMilestone.subjectUserId],
      ["participant_profile", engagementMilestone.subjectProfileId],
    ],
  },
  campaign_recipient: {
    table: campaignRecipient,
    subjects: [["user", campaignRecipient.userId]],
  },
  cms_post: {
    table: cmsPost,
    subjects: [
      ["user", cmsPost.createdBy],
      ["user", cmsPost.updatedBy],
    ],
  },
  competition: {
    table: competition,
    subjects: [["user", competition.createdByUserId]],
  },
  consent_event: {
    table: consentEvent,
    subjects: [
      [consentEvent.subjectType, consentEvent.subjectId],
      ["user", consentEvent.giverUserId],
    ],
  },
  contact_message: {
    table: contactMessage,
    subjects: [
      ["user", contactMessage.assignedToUserId],
      [
        "user",
        sql`(SELECT ${user.id} FROM ${user} WHERE ${user.email} = ${contactMessage.email})`,
      ],
    ],
  },
  file_asset: {
    table: fileAsset,
    subjects: [["user", fileAsset.ownerUserId]],
  },
  guardian_invitation: {
    table: guardianInvitation,
    subjects: [
      ["participant_profile", guardianInvitation.participantProfileId],
      ["user", guardianInvitation.requestedByUserId],
      ["user", guardianInvitation.acceptedByUserId],
      [
        "user",
        sql`(SELECT ${guardian.userId} FROM ${guardian} WHERE ${guardian.id} = ${guardianInvitation.guardianId})`,
      ],
    ],
  },
  institution_invitation: {
    table: institutionInvitation,
    subjects: [
      ["institution", institutionInvitation.institutionId],
      ["user", institutionInvitation.invitedByUserId],
      ["user", institutionInvitation.acceptedByUserId],
      ["user", institutionInvitation.revokedByUserId],
    ],
  },
  institution_registration: {
    table: institutionRegistration,
    subjects: [
      ["institution", institutionRegistration.institutionId],
      ["user", institutionRegistration.registeredBy],
    ],
  },
  payment_batch: {
    table: paymentBatch,
    subjects: [
      ["institution", paymentBatch.institutionId],
      ["user", paymentBatch.payerUserId],
    ],
  },
  refund: {
    table: refund,
    subjects: [
      ["user", refund.requestedBy],
      ["user", refund.decidedBy],
      ["user", refund.manualRecordedBy],
      [
        "user",
        sql`(SELECT ${paymentBatch.payerUserId} FROM ${paymentBatch} WHERE ${paymentBatch.id} = ${refund.batchId})`,
      ],
      [
        "institution",
        sql`(SELECT ${paymentBatch.institutionId} FROM ${paymentBatch} WHERE ${paymentBatch.id} = ${refund.batchId})`,
      ],
    ],
  },
  registration: {
    table: registration,
    subjects: [
      ["participant_profile", registration.participantProfileId],
      [
        "institution",
        sql`(SELECT ${institutionRegistration.institutionId} FROM ${institutionRegistration}
        WHERE ${institutionRegistration.id} = ${registration.institutionRegistrationId})`,
      ],
    ],
  },
  rubric: {
    table: rubric,
    subjects: [
      ["user", rubric.createdByUserId],
      ["user", rubric.publishedByUserId],
    ],
  },
  safeguarding_report: {
    table: safeguardingReport,
    subjects: [["user", safeguardingReport.assignedToUserId]],
  },
} satisfies Partial<Record<DomainEvent["aggregate"]["type"], AggregateSource>>;

function payloadSubjects(
  row: Pick<OutboxRow, "eventType" | "payload">
): SubjectRef[] {
  if (!Object.hasOwn(EVENT_PAYLOADS, row.eventType)) return [];
  const parsed = parseStoredEventPayload(
    row.eventType as EventType,
    row.payload
  );
  if (!parsed.success) return [];
  const payload = parsed.data;
  const subjects: SubjectRef[] = [];
  if ("userId" in payload) subjects.push({ type: "user", id: payload.userId });
  if ("payerUserId" in payload && payload.payerUserId !== null) {
    subjects.push({ type: "user", id: payload.payerUserId });
  }
  if ("institutionId" in payload && typeof payload.institutionId === "string") {
    subjects.push({ type: "institution", id: payload.institutionId });
  }
  if ("subjectType" in payload) {
    subjects.push({ type: payload.subjectType, id: payload.subjectId });
  }
  return subjects;
}

async function linkedSubjects(
  db: AppDb,
  { table, subjects }: AggregateSource,
  ids: string[]
) {
  const rows = await db
    .select({ ...subjectSelection(subjects), id: sql<string>`${table.id}` })
    .from(table)
    .where(inArray(table.id, ids));
  return new Map(rows.map((row) => [row.id, subjectsOf(row, subjects)]));
}

/** Resolve the recorded subjects for each locked, dispatched delivery. */
export async function dispatchedSubjects(db: AppDb, ids: string[]) {
  const deliveries = await db
    .select({
      id: outbox.id,
      aggregateType: outbox.aggregateType,
      aggregateId: outbox.aggregateId,
      eventType: outbox.eventType,
      payload: outbox.payload,
    })
    .from(outbox)
    .where(inArray(outbox.id, ids));

  const aggregates = new Map<string, Set<string>>();
  for (const { aggregateType, aggregateId } of deliveries) {
    const group = aggregates.get(aggregateType) ?? new Set<string>();
    group.add(aggregateId);
    aggregates.set(aggregateType, group);
  }
  const links = new Map<string, Awaited<ReturnType<typeof linkedSubjects>>>();
  for (const [type, source] of Object.entries(aggregateSources)) {
    const group = aggregates.get(type);
    if (group) links.set(type, await linkedSubjects(db, source, [...group]));
  }
  return new Map(
    deliveries.map((row) => [
      row.id,
      [
        ...payloadSubjects(row),
        ...(links.get(row.aggregateType)?.get(row.aggregateId) ?? []),
      ],
    ])
  );
}
