import { sql } from "drizzle-orm";
import { survey, surveyInvitation } from "../../../db/schema";
import { rowPolicy } from "./define";
export const SURVEY_RESPONSES = rowPolicy({
  key: "surveyResponses",
  table: surveyInvitation,
  action: "delete",
  period: "surveyResponses",
  anchor:
    sql<Date>`(SELECT coalesce(${survey.closedAt},${survey.closesAt}) FROM ${survey} WHERE ${survey.id}=${surveyInvitation.surveyId})`.mapWith(
      survey.closesAt
    ),
  subjects: [["user", surveyInvitation.userId]],
});
