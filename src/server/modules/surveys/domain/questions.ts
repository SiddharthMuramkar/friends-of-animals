// The questions a competition manager puts in a survey, and the rules a
// survey's question list must keep. The builder saves the whole list at
// once; this decides whether it is acceptable and normalises it (trimmed
// text, options only on choice questions, prompts never required).
//
// Pure: loads under plain Node (schema, seed), relative imports only.

import { z } from "zod";

export const QUESTION_KINDS = [
  "rating_1_5",
  "single_choice",
  "multiple_choice",
  "free_text",
  /** Text shown between questions, with nothing to answer. */
  "prompt",
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** Defaults until FOA says otherwise (HR-66). */
export const SURVEY_LIMITS = {
  maxQuestions: 20,
  minOptions: 2,
  maxOptions: 10,
  maxQuestionText: 300,
  maxOptionLabel: 120,
  maxFreeText: 2000,
} as const;

export type ChoiceOption = { id: string; label: string };

export type SurveyQuestion = {
  id: string;
  kind: QuestionKind;
  text: string;
  /** Empty unless the kind is a choice. */
  options: readonly ChoiceOption[];
  required: boolean;
};

export type QuestionErrorCode =
  | "invalid"
  | "too_many_questions"
  | "duplicate_question_id"
  | "text_required"
  | "text_too_long"
  | "too_few_options"
  | "too_many_options"
  | "duplicate_option"
  | "option_label_required"
  | "option_label_too_long"
  | "options_not_allowed"
  | "prompt_not_answerable";

/** `index` is the question's position, or null for the list as a whole. */
export type QuestionError = { index: number | null; code: QuestionErrorCode };

const questionShape = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(QUESTION_KINDS),
  text: z.string(),
  options: z
    .array(z.object({ id: z.string().min(1).max(64), label: z.string() }))
    .optional(),
  required: z.boolean().optional(),
});

const CHOICE_KINDS: ReadonlySet<QuestionKind> = new Set<QuestionKind>([
  "single_choice",
  "multiple_choice",
]);

export function isChoiceKind(kind: QuestionKind): boolean {
  return CHOICE_KINDS.has(kind);
}

/** Checks a whole question list, as the builder submits it. */
export function parseSurveyQuestions(
  input: unknown
):
  | { ok: true; questions: SurveyQuestion[] }
  | { ok: false; errors: QuestionError[] } {
  if (!Array.isArray(input)) {
    return { ok: false, errors: [{ index: null, code: "invalid" }] };
  }
  if (input.length > SURVEY_LIMITS.maxQuestions) {
    return { ok: false, errors: [{ index: null, code: "too_many_questions" }] };
  }

  const errors: QuestionError[] = [];
  const questions: SurveyQuestion[] = [];
  const seenIds = new Set<string>();

  input.forEach((raw: unknown, index) => {
    const parsed = questionShape.safeParse(raw);
    if (!parsed.success) {
      errors.push({ index, code: "invalid" });
      return;
    }
    const { id, kind } = parsed.data;
    const fail = (code: QuestionErrorCode) => errors.push({ index, code });
    const before = errors.length;

    if (seenIds.has(id)) fail("duplicate_question_id");
    seenIds.add(id);

    const text = parsed.data.text.trim();
    if (text === "") fail("text_required");
    else if (text.length > SURVEY_LIMITS.maxQuestionText) fail("text_too_long");

    const options = (parsed.data.options ?? []).map((option) => ({
      id: option.id,
      label: option.label.trim(),
    }));
    if (isChoiceKind(kind)) {
      for (const code of optionErrors(options)) fail(code);
    } else if (options.length > 0) {
      fail("options_not_allowed");
    }

    const required = parsed.data.required ?? false;
    if (kind === "prompt" && required) fail("prompt_not_answerable");

    if (errors.length === before) {
      questions.push({ id, kind, text, options, required });
    }
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, questions };
}

function optionErrors(options: readonly ChoiceOption[]): QuestionErrorCode[] {
  const codes: QuestionErrorCode[] = [];
  if (options.length < SURVEY_LIMITS.minOptions) codes.push("too_few_options");
  if (options.length > SURVEY_LIMITS.maxOptions) codes.push("too_many_options");

  const ids = new Set(options.map((option) => option.id));
  const labels = new Set(options.map((option) => option.label.toLowerCase()));
  if (ids.size < options.length || labels.size < options.length) {
    codes.push("duplicate_option");
  }
  if (options.some((option) => option.label === "")) {
    codes.push("option_label_required");
  }
  if (
    options.some((option) => option.label.length > SURVEY_LIMITS.maxOptionLabel)
  ) {
    codes.push("option_label_too_long");
  }
  return codes;
}

/** The questions a respondent can answer: everything but prompts. */
export function answerableQuestions(
  questions: readonly SurveyQuestion[]
): SurveyQuestion[] {
  return questions.filter((question) => question.kind !== "prompt");
}
