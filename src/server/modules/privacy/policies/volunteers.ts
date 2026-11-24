// Retention for volunteer applications (#123). An application that closed
// without approval (declined by a community manager or the guardian, or
// withdrawn) is deleted a year after it closed. An approved application
// is the record behind the person's volunteer role, so it stays while they
// volunteer; no job removes it yet (HR-31).
//
// Loads under plain Node: relative imports only, no "server-only".

import { inArray } from "drizzle-orm";

import { volunteerApplication } from "../../../db/schema";
import { rowPolicy } from "./define";

export const VOLUNTEER_APPLICATIONS = rowPolicy({
  key: "volunteerApplications",
  table: volunteerApplication,
  action: "delete",
  period: "volunteerApplications",
  // Set on every closed status (check volunteer_application_closed_at_matches_status).
  anchor: volunteerApplication.closedAt,
  where: inArray(volunteerApplication.status, [
    "guardian_declined",
    "declined",
    "withdrawn",
  ]),
  subjects: [
    ["user", volunteerApplication.applicantUserId],
    ["user", volunteerApplication.guardianUserId],
    ["user", volunteerApplication.decidedByUserId],
  ],
});
