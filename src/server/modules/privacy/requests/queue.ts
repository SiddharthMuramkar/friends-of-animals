// The grievance officer's queue and request page (#115a).
//
//   listGrievanceQueue({ status?, assignee?, type? }) → requests with their
//                                                       due dates and flags
//   getGrievanceRequest({ id })                       → one request, its
//                                                       words decrypted, its
//                                                       notes and next steps
//
// Both are for the grievance officer alone. The queue shows no free text,
// so a glance at it exposes nobody's words; opening a request is audited,
// since its page shows what the requester wrote.
//
// Open requests list earliest due first; closed ones newest first. A
// request is overdue from the instant its due time passes while it is
// open; days left count India's calendar days (./domain/due.ts).
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../../../db/app-db";
import {
  participantProfile,
  privacyRequest,
  privacyRequestNote,
  user,
  type PrivacyRequestRow,
  type RetainedCategory,
} from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import { openOrNull } from "./content";
import { privacyRequestAuditSnapshot } from "./domain/audit";
import { queueFlags } from "./domain/due";
import type { PrivacySubjectKind, RequestRelation } from "./domain/filing";
import {
  isOpenRequest,
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
  type RequestEvent,
} from "./domain/request-status";
import { grievanceOfficers, namesOf, type PersonRef } from "./people";
import { NOT_FOUND, withOfficer } from "./with-officer";

/** The most requests one page of the queue lists. */
export const QUEUE_LIMIT = 200;

const OPEN_STATUSES = ["submitted", "in_progress"] as const;

export type QueueItem = {
  id: string;
  reference: string;
  type: PrivacyRequestType;
  relation: RequestRelation;
  status: PrivacyRequestStatus;
  dueAt: Date;
  /** India calendar days until due (0: today; negative: late); null once closed. */
  daysLeft: number | null;
  overdue: boolean;
  assignee: PersonRef | null;
  createdAt: Date;
  closedAt: Date | null;
};

export type QueueFilter = {
  status?: "open" | "closed" | PrivacyRequestStatus;
  /** "me", "unassigned", or an officer's user id. */
  assignee?: string;
  type?: PrivacyRequestType;
};

export type ListGrievanceQueueResult =
  | { ok: true; requests: QueueItem[]; more: boolean }
  | InvalidInput;

const queueInput = z
  .strictObject({
    status: z.enum(["open", "closed", ...PRIVACY_REQUEST_STATUSES]).optional(),
    assignee: z
      .union([z.literal("me"), z.literal("unassigned"), z.uuid()])
      .optional(),
    type: z.enum(PRIVACY_REQUEST_TYPES).optional(),
  })
  .optional();

function statusCondition(status: QueueFilter["status"]): SQL | undefined {
  switch (status) {
    case undefined:
      return undefined;
    case "open":
      return inArray(privacyRequest.status, [...OPEN_STATUSES]);
    case "closed":
      return notInArray(privacyRequest.status, [...OPEN_STATUSES]);
    default:
      return eq(privacyRequest.status, status);
  }
}

function itemOf(
  row: PrivacyRequestRow,
  names: ReadonlyMap<string, string>,
  now: Date
): QueueItem {
  const flags = queueFlags({ status: row.status, dueAt: row.dueAt, now });
  const assigneeName =
    row.assignedToUserId === null ? undefined : names.get(row.assignedToUserId);
  return {
    id: row.id,
    reference: row.reference,
    type: row.type,
    relation: row.relation,
    status: row.status,
    dueAt: row.dueAt,
    daysLeft: flags.daysLeft,
    overdue: flags.overdue,
    assignee:
      row.assignedToUserId !== null && assigneeName !== undefined
        ? { id: row.assignedToUserId, name: assigneeName }
        : null,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
  };
}

export async function listGrievanceQueue(
  ctx: UseCaseContext,
  input?: QueueFilter
): Promise<ListGrievanceQueueResult> {
  return withOfficer<ListGrievanceQueueResult>(
    ctx,
    "privacy_request.queue",
    async (tx, officer) => {
      const parsed = queueInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const filter = parsed.data ?? {};
      const status = filter.status ?? "open";
      const assignee =
        filter.assignee === undefined
          ? undefined
          : filter.assignee === "unassigned"
            ? isNull(privacyRequest.assignedToUserId)
            : eq(
                privacyRequest.assignedToUserId,
                filter.assignee === "me" ? officer.userId : filter.assignee
              );
      const openList =
        status === "open" ||
        (status !== "closed" && isOpenRequest(status as PrivacyRequestStatus));
      const rows = await tx
        .select()
        .from(privacyRequest)
        .where(
          and(
            statusCondition(status),
            assignee,
            filter.type === undefined
              ? undefined
              : eq(privacyRequest.type, filter.type)
          )
        )
        .orderBy(
          ...(openList
            ? [asc(privacyRequest.dueAt), asc(privacyRequest.id)]
            : [desc(privacyRequest.closedAt), desc(privacyRequest.id)])
        )
        .limit(QUEUE_LIMIT + 1);
      const page = rows.slice(0, QUEUE_LIMIT);
      const names = await namesOf(
        tx,
        page.map((row) => row.assignedToUserId)
      );
      const now = ctx.clock.now();
      return {
        result: {
          ok: true,
          requests: page.map((row) => itemOf(row, names, now)),
          more: rows.length > QUEUE_LIMIT,
        } as const,
      };
    }
  );
}

export type GrievanceNote = {
  id: string;
  author: PersonRef | null;
  body: string;
  createdAt: Date;
};

export type GrievanceRequestView = QueueItem & {
  subjectKind: PrivacySubjectKind;
  subjectId: string;
  /** The account or child the request is about, by name; null once erased. */
  subjectName: string | null;
  /** Whoever filed it, with the address to reach them; null once erased. */
  requester: (PersonRef & { email: string | null }) | null;
  startedAt: Date | null;
  correctionDetails: string | null;
  rejectionReason: string | null;
  resolution: string | null;
  retained: RetainedCategory[] | null;
  /** Where its data export stands; the officer never gets a link. */
  exportState: "none" | "preparing" | "ready" | "expired";
  erasure: {
    approvedAt: Date | null;
    failure: "plan_changed" | null;
  };
  notes: GrievanceNote[];
  /** The officers it can be assigned to. */
  officers: PersonRef[];
  /** The steps the transition table allows next. */
  allowedEvents: RequestEvent[];
};

export type GetGrievanceRequestResult =
  | { ok: true; request: GrievanceRequestView }
  | InvalidInput
  | { ok: false; error: "not_found" };

const idInput = z.strictObject({ id: z.uuid() });

function exportStateOf(
  row: PrivacyRequestRow,
  now: Date
): GrievanceRequestView["exportState"] {
  if (row.exportRequestedAt === null) return "none";
  if (row.exportDeletedAt !== null) return "expired";
  if (row.exportExpiresAt === null) return "preparing";
  return now < row.exportExpiresAt ? "ready" : "expired";
}

/** The next steps an officer may take on an open request of this type. */
function allowedEvents(row: PrivacyRequestRow): RequestEvent[] {
  if (!isOpenRequest(row.status)) return [];
  const events: RequestEvent[] =
    row.status === "submitted" ? ["start", "reject"] : ["reject"];
  if (row.status === "in_progress" && row.type === "correction") {
    events.unshift("complete");
  }
  return events;
}

export async function getGrievanceRequest(
  ctx: UseCaseContext,
  input: { id: string }
): Promise<GetGrievanceRequestResult> {
  return withOfficer<GetGrievanceRequestResult>(
    ctx,
    "privacy_request.view",
    async (tx) => {
      const parsed = idInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const [row] = await tx
        .select()
        .from(privacyRequest)
        .where(eq(privacyRequest.id, parsed.data.id));
      if (!row) return { result: NOT_FOUND };

      const noteRows = await tx
        .select()
        .from(privacyRequestNote)
        .where(eq(privacyRequestNote.requestId, row.id))
        .orderBy(asc(privacyRequestNote.id));
      const names = await namesOf(tx, [
        row.assignedToUserId,
        ...noteRows.map((note) => note.authorUserId),
      ]);
      const [requester] =
        row.requestedByUserId === null
          ? []
          : await tx
              .select({ id: user.id, name: user.name, email: user.email })
              .from(user)
              .where(eq(user.id, row.requestedByUserId));
      const subjectName = await subjectNameOf(tx, row);
      const now = ctx.clock.now();
      const request: GrievanceRequestView = {
        ...itemOf(row, names, now),
        subjectKind: row.subjectKind,
        subjectId: row.subjectId,
        subjectName,
        requester: requester ?? null,
        startedAt: row.startedAt,
        correctionDetails: openOrNull(
          ctx.cipher,
          "correctionDetails",
          row.correctionDetails
        ),
        rejectionReason: openOrNull(
          ctx.cipher,
          "rejectionReason",
          row.rejectionReason
        ),
        resolution: openOrNull(ctx.cipher, "resolution", row.resolution),
        retained: row.retained,
        exportState: exportStateOf(row, now),
        erasure: {
          approvedAt: row.erasureApprovedAt,
          failure: row.erasureFailure,
        },
        notes: noteRows.map((note) => {
          const authorName =
            note.authorUserId === null
              ? undefined
              : names.get(note.authorUserId);
          return {
            id: note.id,
            author:
              note.authorUserId !== null && authorName !== undefined
                ? { id: note.authorUserId, name: authorName }
                : null,
            body: openOrNull(ctx.cipher, "noteBody", note.body)!,
            createdAt: note.createdAt,
          };
        }),
        officers: await grievanceOfficers(tx),
        allowedEvents: allowedEvents(row),
      };
      return {
        result: { ok: true, request } as const,
        audit: {
          action: "privacy_request.viewed",
          entity: { type: "privacy_request", id: row.id },
          before: null,
          after: privacyRequestAuditSnapshot(row, { notes: noteRows.length }),
        },
      };
    }
  );
}

async function subjectNameOf(
  tx: AppDb,
  row: PrivacyRequestRow
): Promise<string | null> {
  if (row.subjectKind === "user") {
    const [account] = await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, row.subjectId));
    return account?.name ?? null;
  }
  const [profile] = await tx
    .select({ name: participantProfile.fullName })
    .from(participantProfile)
    .where(eq(participantProfile.id, row.subjectId));
  return profile?.name ?? null;
}
