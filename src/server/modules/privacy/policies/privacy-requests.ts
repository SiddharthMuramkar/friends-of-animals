// Retention for privacy rights requests (#115): a closed request, with the
// grievance officer's notes (ON DELETE CASCADE), stays as the record of
// what was asked and answered, then goes. An open one is never touched.
// A legal hold on the person it is about, or on whoever filed it, keeps it.
//
// Loads under plain Node: relative imports only, no "server-only".

import { isNotNull } from "drizzle-orm";

import { privacyRequest } from "../../../db/schema";
import { rowPolicy } from "./define";

export const PRIVACY_REQUESTS = rowPolicy({
  key: "privacyRequests",
  table: privacyRequest,
  action: "delete",
  period: "privacyRequests",
  anchor: privacyRequest.closedAt,
  where: isNotNull(privacyRequest.closedAt),
  subjects: [
    [privacyRequest.subjectKind, privacyRequest.subjectId],
    ["user", privacyRequest.requestedByUserId],
  ],
});
