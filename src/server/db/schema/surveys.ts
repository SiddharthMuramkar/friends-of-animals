import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { competition } from "./competitions";
import { user } from "./identity";
import type { SurveyQuestion } from "../../modules/surveys/questions";
const at = (name: string) => timestamp(name, { withTimezone: true });
export const survey = pgTable(
  "survey",
  {
    id: uuid().primaryKey(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id)
      .unique(),
    title: text().notNull(),
    questions: jsonb().$type<SurveyQuestion[]>().notNull(),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
    sentAt: at("sent_at"),
    closesAt: at("closes_at"),
    closedAt: at("closed_at"),
  },
  (t) => [
    check(
      "survey_send_dates",
      sql`(${t.sentAt} IS NULL) = (${t.closesAt} IS NULL) AND (${t.closesAt} IS NULL OR ${t.closesAt} > ${t.sentAt}) AND (${t.closedAt} IS NULL OR ${t.sentAt} IS NOT NULL)`
    ),
  ]
);

export const surveyDeliveryStatus = pgEnum("survey_delivery_status", [
  "queued",
  "sent",
  "skipped",
]);
export const surveyInvitation = pgTable(
  "survey_invitation",
  {
    id: uuid().primaryKey(),
    surveyId: uuid("survey_id")
      .notNull()
      .references(() => survey.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    status: surveyDeliveryStatus().notNull().default("queued"),
    createdAt: at("created_at").notNull(),
    answers: jsonb().$type<number[]>(),
    answeredAt: at("answered_at"),
  },
  (t) => [
    unique("survey_person_once").on(t.surveyId, t.userId),
    index("survey_invitation_user_idx").on(t.userId),
    check(
      "survey_answer_stamp",
      sql`(${t.answers} IS NULL) = (${t.answeredAt} IS NULL)`
    ),
  ]
);
