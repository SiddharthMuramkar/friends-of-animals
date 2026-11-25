import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/components/form";
import type { SurveyQuestion } from "@/server/modules/surveys/questions";
export async function AnswerForm({
  survey,
  action,
}: {
  survey: { title: string; questions: SurveyQuestion[] };
  action: (data: FormData) => Promise<void>;
}) {
  const t = await getTranslations("surveys");
  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface p-5 text-ink">
      <h2 className="text-h3">{survey.title}</h2>
      <p className="mt-3 text-ink-muted">{t("answerHelp")}</p>
      <form action={action} className="mt-6 flex flex-col gap-6">
        {survey.questions.map((q, i) => (
          <fieldset className="flex flex-col gap-2" key={i}>
            <legend className="mb-2 font-semibold">{q.text}</legend>
            {q.choices.map((choice, j) => (
              <div
                key={j}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-border p-3"
              >
                <input
                  type="radio"
                  required
                  id={`survey-answer-${i}-${j}`}
                  name={`q${i}`}
                  value={j}
                  className="size-5 shrink-0"
                />
                <label className="flex-1" htmlFor={`survey-answer-${i}-${j}`}>
                  {choice}
                </label>
              </div>
            ))}
          </fieldset>
        ))}
        <SubmitButton pendingLabel={t("loading")}>{t("submit")}</SubmitButton>
      </form>
    </div>
  );
}
