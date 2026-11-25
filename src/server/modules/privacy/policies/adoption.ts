// Retention for adoption applications (#130). A closed application
// (adopted, not matched, declined, withdrawn, or closed with its listing)
// is deleted, with its success story, two years after it closed; one
// whose success story is still published stays while the story is up
// (HR-31).
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, isNotNull, sql } from "drizzle-orm";

import { adoptionApplication } from "../../../db/schema";
import { rowPolicy } from "./define";

export const ADOPTION_APPLICATIONS = rowPolicy({
  key: "adoptionApplications",
  table: adoptionApplication,
  action: "delete",
  period: "adoptionApplications",
  // Set on every closed status (check adoption_application_closed_at_matches_status).
  anchor: adoptionApplication.closedAt,
  where: and(
    isNotNull(adoptionApplication.closedAt),
    sql`NOT EXISTS (SELECT 1 FROM "adoption_story" WHERE "adoption_story"."application_id" = ${adoptionApplication.id} AND "adoption_story"."status" = 'published')`
  ),
  subjects: [
    ["user", adoptionApplication.applicantUserId],
    ["user", adoptionApplication.decidedByUserId],
  ],
});
