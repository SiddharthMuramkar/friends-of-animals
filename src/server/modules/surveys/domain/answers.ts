// What a respondent may submit for a survey's questions. The answer form
// posts one value per question (strings from form data, or numbers and
// arrays from a script); this checks them against the questions and
// returns the answers to store, in question order. Blank optional answers
// are not stored, so "skipped" and "not asked" read the same in results.
//
// Pure: loads under plain Node, relative imports only.

import { SURVEY_LIMITS, type SurveyQuestion } from "./questions";

/** What `survey_answer.value` holds: a rating, an option id, option ids, text. */
export type AnswerValue = number | string | readonly string[];

export type Answer = { questionId: string; value: AnswerValue };

export type AnswerErrorCode =
  | "required"
  | "out_of_range"
  | "unknown_option"
  | "duplicate_option"
  | "too_long"
  | "not_answerable"
  | "unknown_question"
  | "invalid";

export type AnswerError = { questionId: string; code: AnswerErrorCode };

type Checked =
  | { kind: "answer"; value: AnswerValue }
  | { kind: "blank" }
  | { kind: "error"; code: AnswerErrorCode };

const BLANK: Checked = { kind: "blank" };
const fail = (code: AnswerErrorCode): Checked => ({ kind: "error", code });

/** Checks a whole submission. `raw` maps question ids to submitted values. */
export function parseAnswers(
  questions: readonly SurveyQuestion[],
  raw: Readonly<Record<string, unknown>>
): { ok: true; answers: Answer[] } | { ok: false; errors: AnswerError[] } {
  const answers: Answer[] = [];
  const errors: AnswerError[] = [];
  const byId = new Map(questions.map((question) => [question.id, question]));

  for (const question of questions) {
    if (question.kind === "prompt") {
      if (Object.hasOwn(raw, question.id)) {
        errors.push({ questionId: question.id, code: "not_answerable" });
      }
      continue;
    }
    const checked = checkAnswer(question, raw[question.id]);
    if (checked.kind === "error") {
      errors.push({ questionId: question.id, code: checked.code });
    } else if (checked.kind === "answer") {
      answers.push({ questionId: question.id, value: checked.value });
    } else if (question.required) {
      errors.push({ questionId: question.id, code: "required" });
    }
  }

  for (const questionId of Object.keys(raw)) {
    if (!byId.has(questionId)) {
      errors.push({ questionId, code: "unknown_question" });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, answers };
}

function checkAnswer(question: SurveyQuestion, value: unknown): Checked {
  if (value === undefined || value === null) return BLANK;
  switch (question.kind) {
    case "rating_1_5":
      return checkRating(value);
    case "single_choice":
      return checkSingle(question, value);
    case "multiple_choice":
      return checkMultiple(question, value);
    case "free_text":
      return checkFreeText(value);
    case "prompt":
      return fail("not_answerable");
  }
}

function checkRating(value: unknown): Checked {
  if (value === "") return BLANK;
  let rating: number;
  if (typeof value === "number") rating = value;
  else if (typeof value === "string") rating = Number(value.trim());
  else return fail("invalid");
  return Number.isInteger(rating) && rating >= 1 && rating <= 5
    ? { kind: "answer", value: rating }
    : fail("out_of_range");
}

function checkSingle(question: SurveyQuestion, value: unknown): Checked {
  if (typeof value !== "string") return fail("invalid");
  if (value === "") return BLANK;
  return question.options.some((option) => option.id === value)
    ? { kind: "answer", value }
    : fail("unknown_option");
}

function checkMultiple(question: SurveyQuestion, value: unknown): Checked {
  const picked = typeof value === "string" ? [value] : value;
  if (
    !Array.isArray(picked) ||
    !picked.every((item): item is string => typeof item === "string")
  ) {
    return fail("invalid");
  }
  const chosen = picked.filter((item) => item !== "");
  if (chosen.length === 0) return BLANK;
  if (new Set(chosen).size < chosen.length) return fail("duplicate_option");
  const offered = question.options.map((option) => option.id);
  if (!chosen.every((id) => offered.includes(id))) {
    return fail("unknown_option");
  }
  // Stored in the question's option order, so equal choices compare equal.
  return {
    kind: "answer",
    value: offered.filter((id) => chosen.includes(id)),
  };
}

function checkFreeText(value: unknown): Checked {
  if (typeof value !== "string") return fail("invalid");
  const text = value.trim();
  if (text === "") return BLANK;
  return text.length > SURVEY_LIMITS.maxFreeText
    ? fail("too_long")
    : { kind: "answer", value: text };
}
