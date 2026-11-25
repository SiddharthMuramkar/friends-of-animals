import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { ROUTES } from "@/lib/routes";
import { surveyAnswerPath, DASHBOARD_SURVEYS } from "@/lib/app-routes";
import { SiteLink } from "@/components/site/site-link";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { SurveyFeedback } from "@/components/surveys/feedback";
import { AnswerForm } from "@/components/surveys/answer-form";
import { answerAction } from "./actions";
export async function generateMetadata() {
  const t = await getTranslations("surveys");
  return {
    title: t("dashboardTitle"),
    robots: { index: false, follow: false },
  };
}
export default async function Page(props: PageProps<"/dashboard/surveys">) {
  const t = await getTranslations("surveys");
  return (
    <Section hue="teal" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader title={t("dashboardTitle")} lead={t("dashboardLead")} />
      <Suspense fallback={<p>{t("loading")}</p>}>
        <Content {...props} />
      </Suspense>
    </Section>
  );
}
async function Content({ searchParams }: PageProps<"/dashboard/surveys">) {
  const t = await getTranslations("surveys");
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const api = as(actor);
  const query = await searchParams;
  const id =
    typeof query.competitionId === "string" ? query.competitionId : null;
  if (id) {
    const form = await api.getSurveyAnswerForm({ competitionId: id });
    return (
      <div className="mt-6">
        <SiteLink href={DASHBOARD_SURVEYS} className="underline">
          {t("back")}
        </SiteLink>
        <SurveyFeedback result={query.result} />
        {form ? (
          <AnswerForm
            survey={form}
            action={answerAction.bind(null, { competitionId: id })}
          />
        ) : (
          query.result !== "complete" && <p>{t("unavailable")}</p>
        )}
      </div>
    );
  }
  const rows = await api.mySurveys();
  return (
    <div className="mt-6">
      {rows.length ? (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.competitionId}>
              <SiteLink
                href={surveyAnswerPath(r.competitionId)}
                className="block rounded-xl border border-border bg-surface p-4 underline"
              >
                {t("answer", { title: r.title })}
              </SiteLink>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("noSurveys")}</p>
      )}
    </div>
  );
}
