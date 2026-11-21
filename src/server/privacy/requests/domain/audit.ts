// What a rights request's audit rows may say (#115). The audit log is
// append-only and outlives erasure, so a request's `before` and `after`
// carry its lifecycle fields and the assignee's id only: never the
// correction details, the rejection reason, a note, or who the request is
// about beyond its kind. Use cases build the JSON with the snapshot below
// and parse it with the strict schema before writing.
//
// Pure, and loads under plain Node.

import { z } from "zod";

import {
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from "./request-status";
import type { PrivacySubjectKind, RequestRelation } from "./filing";

export const privacyRequestAuditSchema = z.strictObject({
  type: z.enum(PRIVACY_REQUEST_TYPES),
  status: z.enum(PRIVACY_REQUEST_STATUSES),
  relation: z.enum(["self", "guardian"]),
  subjectKind: z.enum(["user", "participant_profile"]),
  assignedToUserId: z.uuid().nullable(),
  /** How many internal notes the request has; never their text. */
  notes: z.int().min(0).optional(),
});

export type PrivacyRequestAudit = z.infer<typeof privacyRequestAuditSchema>;

/** The request fields a snapshot reads. Extra fields are ignored. */
export type AuditableRequest = {
  type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  relation: RequestRelation;
  subjectKind: PrivacySubjectKind;
  assignedToUserId: string | null;
};

/** A request as its audit rows may show it. */
export function privacyRequestAuditSnapshot(
  request: AuditableRequest,
  extra: { notes?: number } = {}
): PrivacyRequestAudit {
  return privacyRequestAuditSchema.parse({
    type: request.type,
    status: request.status,
    relation: request.relation,
    subjectKind: request.subjectKind,
    assignedToUserId: request.assignedToUserId,
    ...(extra.notes === undefined ? {} : { notes: extra.notes }),
  });
}
