import { describe, expect, it } from "vitest";

import type { Answer } from "./answers";
import type { SurveyQuestion } from "./questions";
import { aggregateResults } from "./results";

const QUESTIONS: SurveyQuestion[] = [
  { id: "intro", kind: "prompt", text: "Hi", options: [], required: false },
  { id: "q1", kind: "rating_1_5", text: "Rate", options: [], required: true },
  {
    id: "q2",
    kind: "single_choice",
    text: "Again?",
    options: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
      { id: "unsure", label: "Not sure" },
    ],
    required: false,
  },
  {
    id: "q3",
    kind: "multiple_choice",
    text: "Liked",
    options: [
      { id: "a", label: "Art" },
      { id: "b", label: "Books" },
      { id: "c", label: "Cats" },
    ],
    required: false,
  },
  { id: "q4", kind: "free_text", text: "Say", options: [], required: false },
];

/** Seven responses. The expected numbers below were worked out by hand. */
const RESPONSES: Answer[][] = [
  [
    { questionId: "q1", value: 5 },
    { questionId: "q2", value: "yes" },
    { questionId: "q3", value: ["a", "b"] },
    { questionId: "q4", value: "Great day" },
  ],
  [
    { questionId: "q1", value: 4 },
    { questionId: "q2", value: "yes" },
    { questionId: "q3", value: ["a"] },
  ],
  [
    { questionId: "q1", value: 4 },
    { questionId: "q2", value: "no" },
    { questionId: "q3", value: ["b", "c"] },
    { questionId: "q4", value: "Too long" },
  ],
  [
    { questionId: "q1", value: 3 },
    { questionId: "q2", value: "unsure" },
  ],
  [
    { questionId: "q1", value: 5 },
    { questionId: "q2", value: "yes" },
    { questionId: "q3", value: ["a", "c"] },
  ],
  [
    { questionId: "q1", value: 2 },
    { questionId: "q2", value: "no" },
    { questionId: "q4", value: "More cats" },
  ],
  [
    { questionId: "q1", value: 4 },
    { questionId: "q3", value: ["a"] },
  ],
];

describe("aggregateResults", () => {
  it("matches the hand-computed fixture", () => {
    expect(aggregateResults(QUESTIONS, RESPONSES, 10)).toEqual({
      responses: 7,
      invited: 10,
      responseRate: 70,
      questions: [
        {
          questionId: "q1",
          kind: "rating_1_5",
          answered: 7,
          // ratings 5, 4, 4, 3, 5, 2, 4: sum 27 / 7 = 3.857…
          distribution: [0, 1, 1, 3, 2],
          mean: 3.86,
        },
        {
          questionId: "q2",
          kind: "single_choice",
          answered: 6,
          options: [
            { optionId: "yes", count: 3, percent: 50 },
            { optionId: "no", count: 2, percent: 33.3 },
            { optionId: "unsure", count: 1, percent: 16.7 },
          ],
        },
        {
          questionId: "q3",
          kind: "multiple_choice",
          answered: 5,
          // percent of the people who answered this question, so the
          // column adds up to more than 100
          options: [
            { optionId: "a", count: 4, percent: 80 },
            { optionId: "b", count: 2, percent: 40 },
            { optionId: "c", count: 2, percent: 40 },
          ],
        },
        {
          questionId: "q4",
          kind: "free_text",
          answered: 3,
          texts: ["Great day", "Too long", "More cats"],
        },
      ],
    });
  });

  it("rounds the mean half away from zero to 2 decimals", () => {
    // 1 + 1 + 1 + 2 + 2 + 2 + 2 + 2 = 13 / 8 = 1.625 → 1.63
    const ratings = [1, 1, 1, 2, 2, 2, 2, 2].map((value) => [
      { questionId: "q1", value },
    ]);
    const [q1] = aggregateResults(QUESTIONS, ratings, 8).questions;
    expect(q1).toMatchObject({ mean: 1.63, distribution: [3, 5, 0, 0, 0] });
  });

  it("reports empty questions and no responses without dividing by zero", () => {
    expect(aggregateResults(QUESTIONS, [], 0)).toEqual({
      responses: 0,
      invited: 0,
      responseRate: null,
      questions: [
        {
          questionId: "q1",
          kind: "rating_1_5",
          answered: 0,
          distribution: [0, 0, 0, 0, 0],
          mean: null,
        },
        {
          questionId: "q2",
          kind: "single_choice",
          answered: 0,
          options: [
            { optionId: "yes", count: 0, percent: null },
            { optionId: "no", count: 0, percent: null },
            { optionId: "unsure", count: 0, percent: null },
          ],
        },
        {
          questionId: "q3",
          kind: "multiple_choice",
          answered: 0,
          options: [
            { optionId: "a", count: 0, percent: null },
            { optionId: "b", count: 0, percent: null },
            { optionId: "c", count: 0, percent: null },
          ],
        },
        { questionId: "q4", kind: "free_text", answered: 0, texts: [] },
      ],
    });
  });

  it("ignores stored answers that no longer fit the question", () => {
    const stale: Answer[][] = [
      [
        { questionId: "q1", value: 9 },
        { questionId: "q2", value: "gone" },
        { questionId: "gone", value: "x" },
      ],
    ];
    const [q1, q2] = aggregateResults(QUESTIONS, stale, 1).questions;
    expect(q1).toMatchObject({ answered: 0, mean: null });
    expect(q2).toMatchObject({ answered: 0 });
  });
});
