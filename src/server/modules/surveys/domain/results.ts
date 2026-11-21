// Aggregated survey results, as the manager's results page and the
// objective feedback report (#135) show them: per rating question the
// distribution and mean, per choice question the count and share of each
// option, per free-text question the answers themselves (manager only;
// exports leave them out unless the survey says so).
//
// Pure: loads under plain Node, relative imports only.

import type { Answer } from "./answers";
import { answerableQuestions, type SurveyQuestion } from "./questions";

export type QuestionResult =
  | {
      questionId: string;
      kind: "rating_1_5";
      answered: number;
      /** How many chose 1, 2, 3, 4 and 5. */
      distribution: [number, number, number, number, number];
      /** Rounded half away from zero to 2 decimals; null if unanswered. */
      mean: number | null;
    }
  | {
      questionId: string;
      kind: "single_choice" | "multiple_choice";
      answered: number;
      /**
       * In the question's option order. `percent` is the share of this
       * question's respondents, to 1 decimal; null if unanswered.
       */
      options: { optionId: string; count: number; percent: number | null }[];
    }
  | {
      questionId: string;
      kind: "free_text";
      answered: number;
      texts: string[];
    };

export type SurveyResults = {
  responses: number;
  invited: number;
  /** Responses as a percentage of invitations, to 1 decimal. */
  responseRate: number | null;
  questions: QuestionResult[];
};

/**
 * `count / total` scaled by `scale` and rounded half up, in whole-number
 * arithmetic so 1.625 doesn't become 1.62 through floating point.
 */
function ratio(count: number, total: number, scale: number): number | null {
  if (total === 0) return null;
  return Math.floor((2 * count * scale + total) / (2 * total));
}

function percent(count: number, total: number): number | null {
  const tenths = ratio(count, total, 1000);
  return tenths === null ? null : tenths / 10;
}

export function aggregateResults(
  questions: readonly SurveyQuestion[],
  responses: readonly (readonly Answer[])[],
  invited: number
): SurveyResults {
  const valuesFor = (questionId: string) =>
    responses.flatMap((answers) =>
      answers
        .filter((answer) => answer.questionId === questionId)
        .map((answer) => answer.value)
    );

  return {
    responses: responses.length,
    invited,
    responseRate: percent(responses.length, invited),
    questions: answerableQuestions(questions).map((question) =>
      aggregateQuestion(question, valuesFor(question.id))
    ),
  };
}

function aggregateQuestion(
  question: SurveyQuestion,
  values: readonly Answer["value"][]
): QuestionResult {
  const { id: questionId } = question;
  switch (question.kind) {
    case "rating_1_5": {
      const ratings = values.filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isInteger(value) &&
          value >= 1 &&
          value <= 5
      );
      const distribution: [number, number, number, number, number] = [
        0, 0, 0, 0, 0,
      ];
      for (const rating of ratings) distribution[rating - 1] += 1;
      const sum = ratings.reduce((total, rating) => total + rating, 0);
      const hundredths = ratio(sum, ratings.length, 100);
      return {
        questionId,
        kind: "rating_1_5",
        answered: ratings.length,
        distribution,
        mean: hundredths === null ? null : hundredths / 100,
      };
    }
    case "single_choice":
    case "multiple_choice": {
      const offered = new Set(question.options.map((option) => option.id));
      const picks = values
        .map((value) => (typeof value === "string" ? [value] : value))
        .filter(
          (chosen): chosen is readonly string[] =>
            Array.isArray(chosen) &&
            chosen.length > 0 &&
            chosen.every((id) => offered.has(id))
        );
      return {
        questionId,
        kind: question.kind,
        answered: picks.length,
        options: question.options.map((option) => {
          const count = picks.filter((chosen) =>
            chosen.includes(option.id)
          ).length;
          return {
            optionId: option.id,
            count,
            percent: percent(count, picks.length),
          };
        }),
      };
    }
    case "free_text": {
      const texts = values.filter(
        (value): value is string => typeof value === "string"
      );
      return { questionId, kind: "free_text", answered: texts.length, texts };
    }
    case "prompt":
      // answerableQuestions() has already left prompts out.
      throw new Error("A prompt has no results");
  }
}
