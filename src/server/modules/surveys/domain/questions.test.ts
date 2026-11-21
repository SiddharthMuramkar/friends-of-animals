import { describe, expect, it } from "vitest";

import { answerableQuestions, parseSurveyQuestions } from "./questions";

const rating = { id: "q1", kind: "rating_1_5", text: "How was it?" };
const choice = {
  id: "q2",
  kind: "single_choice",
  text: "Would you take part again?",
  options: [
    { id: "yes", label: "Yes" },
    { id: "no", label: "No" },
  ],
};

function errorsOf(input: unknown) {
  const result = parseSurveyQuestions(input);
  if (result.ok) throw new Error("expected the questions to be refused");
  return result.errors;
}

describe("parseSurveyQuestions", () => {
  it("accepts every kind and fills defaults", () => {
    const result = parseSurveyQuestions([
      { id: "intro", kind: "prompt", text: "  A few questions  " },
      rating,
      choice,
      { ...choice, id: "q3", kind: "multiple_choice", required: false },
      { id: "q4", kind: "free_text", text: "Anything else?", required: true },
    ]);

    expect(result).toEqual({
      ok: true,
      questions: [
        {
          id: "intro",
          kind: "prompt",
          text: "A few questions",
          options: [],
          required: false,
        },
        { ...rating, options: [], required: false },
        { ...choice, required: false },
        { ...choice, id: "q3", kind: "multiple_choice", required: false },
        {
          id: "q4",
          kind: "free_text",
          text: "Anything else?",
          options: [],
          required: true,
        },
      ],
    });
  });

  it("refuses a survey with more than 20 questions", () => {
    const questions = Array.from({ length: 21 }, (_, i) => ({
      ...rating,
      id: `q${i}`,
    }));
    expect(errorsOf(questions)).toEqual([
      { index: null, code: "too_many_questions" },
    ]);
  });

  it("refuses two questions with one id", () => {
    expect(errorsOf([rating, { ...rating, text: "Again?" }])).toEqual([
      { index: 1, code: "duplicate_question_id" },
    ]);
  });

  it("refuses blank and overlong question text", () => {
    expect(
      errorsOf([
        { ...rating, text: "   " },
        { ...rating, id: "q9", text: "x".repeat(301) },
      ])
    ).toEqual([
      { index: 0, code: "text_required" },
      { index: 1, code: "text_too_long" },
    ]);
  });

  it("needs 2 to 10 options on a choice question", () => {
    const options = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `O ${i}` }));
    expect(
      errorsOf([
        { ...choice, options: options(1) },
        { ...choice, id: "q3", options: options(11) },
        { ...choice, id: "q4", options: undefined },
      ])
    ).toEqual([
      { index: 0, code: "too_few_options" },
      { index: 1, code: "too_many_options" },
      { index: 2, code: "too_few_options" },
    ]);
  });

  it("refuses repeated option ids and labels that differ only in case or spaces", () => {
    expect(
      errorsOf([
        {
          ...choice,
          options: [
            { id: "a", label: "Yes" },
            { id: "a", label: "No" },
          ],
        },
        {
          ...choice,
          id: "q3",
          options: [
            { id: "a", label: "Yes" },
            { id: "b", label: " yes " },
          ],
        },
      ])
    ).toEqual([
      { index: 0, code: "duplicate_option" },
      { index: 1, code: "duplicate_option" },
    ]);
  });

  it("refuses blank and overlong option labels", () => {
    expect(
      errorsOf([
        {
          ...choice,
          options: [
            { id: "a", label: " " },
            { id: "b", label: "x".repeat(121) },
          ],
        },
      ])
    ).toEqual([
      { index: 0, code: "option_label_required" },
      { index: 0, code: "option_label_too_long" },
    ]);
  });

  it("refuses options on a question that isn't a choice", () => {
    expect(errorsOf([{ ...rating, options: choice.options }])).toEqual([
      { index: 0, code: "options_not_allowed" },
    ]);
  });

  it("refuses a required prompt, which has nothing to answer", () => {
    expect(
      errorsOf([{ id: "p", kind: "prompt", text: "Hi", required: true }])
    ).toEqual([{ index: 0, code: "prompt_not_answerable" }]);
  });

  it("refuses input that isn't a list of questions", () => {
    expect(errorsOf({ questions: [] })).toEqual([
      { index: null, code: "invalid" },
    ]);
    expect(errorsOf([{ ...rating, kind: "slider" }])).toEqual([
      { index: 0, code: "invalid" },
    ]);
  });
});

describe("answerableQuestions", () => {
  it("leaves out prompts", () => {
    const result = parseSurveyQuestions([
      { id: "p", kind: "prompt", text: "Hi" },
      rating,
    ]);
    if (!result.ok) throw new Error("expected valid questions");
    expect(answerableQuestions(result.questions).map((q) => q.id)).toEqual([
      "q1",
    ]);
  });
});
