import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { SubmitButton } from "@/components/form";
import { adminSurveyPath, ADMIN_SURVEYS } from "@/lib/app-routes";
import { SurveyFeedback } from "@/components/surveys/feedback";
import {
  saveSurveyAction,
  sendSurveyAction,
  closeSurveyAction,
} from "./actions";
export async function generateMetadata() {
  const t = await getTranslations("surveys");
  return { title: t("adminTitle"), robots: { index: false, follow: false } };
}
export default async function Page(props: PageProps<"/admin/surveys">) {
  const t = await getTranslations("surveys");
  return (
    <Section hue="blue" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader title={t("adminTitle")} lead={t("adminLead")} />
      <Suspense fallback={<p>{t("loading")}</p>}>
        <Content {...props} />
      </Suspense>
    </Section>
  );
}
const FIELD = "w-full rounded-lg border border-border bg-surface p-3 text-ink";
async function loadSurveyPage(id: string | null) {
  const api = as(await currentActor());
  try {
    const competitions = await api.listSurveyCompetitions();
    const selected = id ? competitions.find((c) => c.id === id) : undefined;
    const view = selected
      ? await api.getSurvey({ competitionId: selected.id })
      : null;
    return { competitions, selected, view };
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    return null;
  }
}
async function Content({ searchParams }: PageProps<"/admin/surveys">) {
  const t = await getTranslations("surveys");
  const query = await searchParams;
  const data = await loadSurveyPage(
    typeof query.competitionId === "string" ? query.competitionId : null
  );
  if (!data) return <p className="mt-6">{t("denied")}</p>;
  const { competitions, selected, view } = data;
  return (
    <div className="mt-6 flex flex-col gap-5 text-ink">
      <h2 className="text-h3">{t("choose")}</h2>
      {!competitions.length && <p>{t("none")}</p>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {competitions.map((c) => (
          <li key={c.id}>
            <SiteLink
              className="block rounded-lg border border-border bg-surface p-3"
              href={adminSurveyPath(c.id)}
            >
              {c.code} — {c.name}
            </SiteLink>
          </li>
        ))}
      </ul>
      <SurveyFeedback result={query.result} />
      {selected && view && (
        <section
          className="rounded-2xl border border-border bg-surface p-5"
          aria-labelledby="selected-competition"
        >
          <h2 id="selected-competition" className="text-h3">
            {selected.name}
          </h2>
          {!view.survey?.sentAt ? (
            <>
              <form
                action={saveSurveyAction.bind(null, selected.id)}
                aria-labelledby="survey-builder-heading"
                className="mt-5 flex flex-col gap-4"
              >
                <label htmlFor="survey-title" className="flex flex-col gap-2">
                  {t("surveyTitle")}
                  <input
                    id="survey-title"
                    name="title"
                    className={FIELD}
                    maxLength={120}
                    required
                    defaultValue={view.survey?.title}
                  />
                </label>
                <h3 className="text-h4" id="survey-builder-heading">
                  {t("builder")}
                </h3>
                <p>{t("builderHelp")}</p>
                {Array.from({ length: 10 }, (_, i) => {
                  const q = view.survey?.questions[i];
                  return (
                    <fieldset
                      key={i}
                      className="rounded-xl border border-border p-3"
                    >
                      <legend className="font-semibold">
                        {t("questionGroup", { number: i + 1 })}
                      </legend>
                      <label
                        htmlFor={`survey-question-${i}`}
                        className="flex flex-col gap-2"
                      >
                        {t("question", { number: i + 1 })}
                        <input
                          className={FIELD}
                          id={`survey-question-${i}`}
                          name={`text${i}`}
                          defaultValue={q?.text}
                          maxLength={300}
                        />
                      </label>
                      <label
                        htmlFor={`survey-choices-${i}`}
                        className="mt-3 flex flex-col gap-2"
                      >
                        {t("choices", { number: i + 1 })}
                        <textarea
                          className={FIELD}
                          rows={3}
                          id={`survey-choices-${i}`}
                          name={`choices${i}`}
                          defaultValue={q?.choices.join("\n")}
                        />
                      </label>
                    </fieldset>
                  );
                })}
                <SubmitButton pendingLabel={t("loading")}>
                  {t("save")}
                </SubmitButton>
              </form>
              {!view.published ? (
                <p className="mt-6">{t("waitForResults")}</p>
              ) : (
                view.survey && (
                  <form
                    action={sendSurveyAction.bind(null, selected.id)}
                    aria-label={t("send")}
                    className="mt-6 flex flex-col gap-3"
                  >
                    <p>{t("sendHelp")}</p>
                    <SubmitButton pendingLabel={t("loading")}>
                      {t("send")}
                    </SubmitButton>
                  </form>
                )
              )}
            </>
          ) : (
            <div className="mt-5 flex flex-col gap-4">
              <p>{t(view.open ? "open" : "closed")}</p>
              <h3 className="text-h4">{view.survey.title}</h3>
              <h3 className="text-h4">{t("aggregate")}</h3>
              {view.results && (
                <>
                  <p>
                    {t("invited", { count: view.results.invited })} ·{" "}
                    {t("responses", { count: view.results.responses })}
                    {view.results.responseRate !== null
                      ? ` · ${t("responseRate", { percent: view.results.responseRate })}`
                      : ""}
                  </p>
                  {view.survey.questions.map((q, i) => (
                    <div key={i}>
                      <h4 className="font-semibold">{q.text}</h4>
                      <ul className="list-disc pl-6">
                        {q.choices.map((label, j) => (
                          <li key={j}>
                            {t("count", {
                              label,
                              count: view.results!.counts[i]![j]!,
                            })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <a
                    className="underline underline-offset-4"
                    href={`${ADMIN_SURVEYS}/export.csv?competitionId=${selected.id}`}
                  >
                    {t("export")}
                  </a>
                </>
              )}
              {view.open && (
                <form
                  action={closeSurveyAction.bind(null, selected.id)}
                  aria-label={t("close")}
                >
                  <SubmitButton pendingLabel={t("loading")}>
                    {t("close")}
                  </SubmitButton>
                </form>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
