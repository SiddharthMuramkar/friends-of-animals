import { z } from "zod";
const label = z.string().trim().min(1).max(120);
export const surveyQuestions = z
  .array(
    z
      .object({
        text: z.string().trim().min(1).max(300),
        choices: z.array(label).min(2).max(10),
      })
      .strict()
      .refine(
        (q) =>
          new Set(q.choices.map((x) => x.toLocaleLowerCase("en-IN"))).size ===
          q.choices.length
      )
  )
  .min(1)
  .max(10);
export type SurveyQuestion = z.infer<typeof surveyQuestions>[number];
export const surveyDraft = z.object({
  title: label,
  questions: surveyQuestions,
});
export function validAnswers(
  questions: SurveyQuestion[],
  input: unknown
): input is number[] {
  return (
    Array.isArray(input) &&
    input.length === questions.length &&
    input.every(
      (value, i) =>
        Number.isInteger(value) &&
        value >= 0 &&
        value < questions[i]!.choices.length
    )
  );
}
