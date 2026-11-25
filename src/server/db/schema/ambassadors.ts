import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { AMBASSADOR_STATUSES } from "../../modules/community/ambassadors/domain/status";
import { encryptedText } from "../types/encrypted-text";
import { user } from "./identity";

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
export const ambassadorApplicationStatus = pgEnum("ambassador_application_status", AMBASSADOR_STATUSES);
export const ambassadorApplication = pgTable("ambassador_application", {
  id: uuid().primaryKey(),
  applicantUserId: uuid("applicant_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  status: ambassadorApplicationStatus().notNull(),
  submittedAt: instant("submitted_at").notNull(),
  decidedAt: instant("decided_at"),
  decidedByUserId: uuid("decided_by_user_id").references(() => user.id, { onDelete: "set null" }),
  declineReasonCiphertext: encryptedText("decline_reason_ciphertext"),
}, (t) => [
  uniqueIndex("ambassador_application_live_unique").on(t.applicantUserId).where(sql`${t.status} IN ('submitted','approved')`),
  check("ambassador_application_decision", sql`(${t.status} = 'submitted' AND ${t.decidedAt} IS NULL AND ${t.decidedByUserId} IS NULL AND ${t.declineReasonCiphertext} IS NULL) OR (${t.status} = 'approved' AND ${t.decidedAt} IS NOT NULL AND ${t.declineReasonCiphertext} IS NULL) OR (${t.status} = 'declined' AND ${t.decidedAt} IS NOT NULL AND ${t.declineReasonCiphertext} IS NOT NULL)`),
  index("ambassador_application_applicant_idx").on(t.applicantUserId, t.submittedAt),
  index("ambassador_application_decider_idx").on(t.decidedByUserId),
  index("ambassador_application_queue_idx").on(t.status, t.submittedAt),
]);
export type AmbassadorApplication = typeof ambassadorApplication.$inferSelect;
