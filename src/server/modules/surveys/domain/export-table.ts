// What a survey's export contains, before it is written as CSV (117b's
// writer does the quoting, BOM and formula neutralising). One row per
// response, one column per answerable question. Personal data goes in only
// when the survey says so: respondent name, email and role on identified
// surveys, free-text answers (which may name people) when the manager
// turned that on. Rows are ordered by the response's random id, so their
// order says nothing about who answered when.
//
// Pure: loads under plain Node, relative imports only.

import type { Answer } from "./answers";
import type { InvitationRole } from "./invitation-plan";
import { answerableQuestions, type SurveyQuestion } from "./questions";

export type ExportSurvey = {
  identified: boolean;
  includeFreeTextInExport: boolean;
  questions: readonly SurveyQuestion[];
};

export type ExportResponse = {
  /** Random (UUIDv4) id; never exported. */
  id: string;
  /** IST calendar date, `YYYY-MM-DD`. */
  submittedOn: string;
  /** Only read for identified surveys. */
  respondent: { name: string; email: string; role: InvitationRole } | null;
  answers: readonly Answer[];
};

/** Fixed column headings, from the `surveys` messages. */
export type ExportLabels = {
  submittedOn: string;
  respondentName: string;
  respondentEmail: string;
  respondentRole: string;
  roles: Record<InvitationRole, string>;
};

export type ExportCell = string | number | null;

export type ExportTable = { header: string[]; rows: ExportCell[][] };

/** Joins the labels of a multiple-choice answer. */
const CHOICE_SEPARATOR = "; ";

export function buildExportTable(
  survey: ExportSurvey,
  responses: readonly ExportResponse[],
  labels: ExportLabels
): ExportTable {
  const columns = answerableQuestions(survey.questions).filter(
    (question) =>
      question.kind !== "free_text" || survey.includeFreeTextInExport
  );

  const header = [
    labels.submittedOn,
    ...(survey.identified
      ? [labels.respondentName, labels.respondentEmail, labels.respondentRole]
      : []),
    ...columns.map((question) => question.text),
  ];

  const rows = [...responses]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((response): ExportCell[] => {
      const identity: ExportCell[] = !survey.identified
        ? []
        : response.respondent === null
          ? [null, null, null]
          : [
              response.respondent.name,
              response.respondent.email,
              labels.roles[response.respondent.role],
            ];
      return [
        response.submittedOn,
        ...identity,
        ...columns.map((question) => cellFor(question, response.answers)),
      ];
    });

  return { header, rows };
}

function cellFor(
  question: SurveyQuestion,
  answers: readonly Answer[]
): ExportCell {
  const value = answers.find(
    (answer) => answer.questionId === question.id
  )?.value;
  if (value === undefined) return null;
  switch (question.kind) {
    case "rating_1_5":
      return typeof value === "number" ? value : null;
    case "single_choice":
    case "multiple_choice": {
      const chosen = typeof value === "string" ? [value] : value;
      if (!Array.isArray(chosen)) return null;
      const picked = question.options.filter((option) =>
        chosen.includes(option.id)
      );
      return picked.length === 0
        ? null
        : picked.map((option) => option.label).join(CHOICE_SEPARATOR);
    }
    case "free_text":
      return typeof value === "string" ? value : null;
    case "prompt":
      return null;
  }
}
