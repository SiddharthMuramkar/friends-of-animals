import { describe, expect, it } from "vitest";

import { parseAnswers } from "./answers";
import type { SurveyQuestion } from "./questions";

const options = [
  { id: "a", label: "Art" },
  { id: "b", label: "Books" },
  { id: "c", label: "Cats" },
];

const QUESTIONS: SurveyQuestion[] = [
  { id: "intro", kind: "prompt", text: "Hi", options: [], required: false },
  { id: "q1", kind: "rating_1_5", text: "Rate", options: [], required: true },
  { id: "q2", kind: "single_choice", text: "One", options, required: false },
  { id: "q3", kind: "multiple_choice", text: "Many", options, required: false },
  { id: "q4", kind: "free_text", text: "Say", options: [], required: false },
];

function errorsOf(raw: Record<string, unknown>) {
  const result = parseAnswers(QUESTIONS, raw);
  if (result.ok) throw new Error("expected the answers to be refused");
  return result.errors;
}

describe("parseAnswers", () => {
  it("normalises each kind of answer, in question order", () => {
    expect(
      parseAnswers(QUESTIONS, {
        q4: "  Loved it  ",
        q3: ["c", "a"],
        q2: "b",
        q1: "4",
      })
    ).toEqual({
      ok: true,
      answers: [
        { questionId: "q1", value: 4 },
        { questionId: "q2", value: "b" },
        { questionId: "q3", value: ["a", "c"] },
        { questionId: "q4", value: "Loved it" },
      ],
    });
  });

  it("accepts a rating as a number and one choice as a bare string", () => {
    expect(parseAnswers(QUESTIONS, { q1: 5, q3: "b" })).toEqual({
      ok: true,
      answers: [
        { questionId: "q1", value: 5 },
        { questionId: "q3", value: ["b"] },
      ],
    });
  });

  it("drops blank optional answers instead of storing them", () => {
    expect(
      parseAnswers(QUESTIONS, { q1: 3, q2: "", q3: [], q4: "   " })
    ).toEqual({ ok: true, answers: [{ questionId: "q1", value: 3 }] });
  });

  it("refuses a missing required answer", () => {
    expect(errorsOf({})).toEqual([{ questionId: "q1", code: "required" }]);
    expect(errorsOf({ q1: "" })).toEqual([
      { questionId: "q1", code: "required" },
    ]);
  });

  it("refuses ratings outside 1 to 5 and non-whole ratings", () => {
    for (const value of [0, 6, 2.5, "4.5", "five", -1]) {
      expect(errorsOf({ q1: value })).toEqual([
        { questionId: "q1", code: "out_of_range" },
      ]);
    }
  });

  it("refuses options the question doesn't offer", () => {
    expect(errorsOf({ q1: 1, q2: "z", q3: ["a", "z"] })).toEqual([
      { questionId: "q2", code: "unknown_option" },
      { questionId: "q3", code: "unknown_option" },
    ]);
  });

  it("refuses the same option twice in a multiple choice", () => {
    expect(errorsOf({ q1: 1, q3: ["a", "a"] })).toEqual([
      { questionId: "q3", code: "duplicate_option" },
    ]);
  });

  it("refuses free text over 2000 characters", () => {
    expect(errorsOf({ q1: 1, q4: "x".repeat(2001) })).toEqual([
      { questionId: "q4", code: "too_long" },
    ]);
    expect(parseAnswers(QUESTIONS, { q1: 1, q4: "x".repeat(2000) }).ok).toBe(
      true
    );
  });

  it("refuses an answer to a prompt and to a question not in the survey", () => {
    expect(errorsOf({ q1: 1, intro: "hello", q99: "x" })).toEqual([
      { questionId: "intro", code: "not_answerable" },
      { questionId: "q99", code: "unknown_question" },
    ]);
  });

  it("refuses values of the wrong type", () => {
    expect(errorsOf({ q1: 1, q2: ["a"], q3: [1], q4: 7 })).toEqual([
      { questionId: "q2", code: "invalid" },
      { questionId: "q3", code: "invalid" },
      { questionId: "q4", code: "invalid" },
    ]);
  });
});
