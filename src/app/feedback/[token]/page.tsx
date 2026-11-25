import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { as, currentActor } from "@/server/app";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { SurveyFeedback } from "@/components/surveys/feedback";
import { AnswerForm } from "@/components/surveys/answer-form";
import { answerAction } from "../../dashboard/surveys/actions";
export async function generateMetadata() {
  const t = await getTranslations("surveys");
  return {
    title: t("answerTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer" as const,
  };
}
export default async function Page(props: PageProps<"/feedback/[token]">) {
  const t = await getTranslations("surveys");
  return (
    <Section hue="teal" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader title={t("answerTitle")} />
      <Suspense fallback={<p>{t("loading")}</p>}>
        <Content {...props} />
      </Suspense>
    </Section>
  );
}
async function Content({
  params,
  searchParams,
}: PageProps<"/feedback/[token]">) {
  const [{ token }, query, t, actor] = await Promise.all([
    params,
    searchParams,
    getTranslations("surveys"),
    currentActor(),
  ]);
  const form = await as(actor).getSurveyAnswerForm({ token });
  return (
    <div className="mt-6">
      <SurveyFeedback result={query.result} />
      {form ? (
        <AnswerForm survey={form} action={answerAction.bind(null, { token })} />
      ) : (
        query.result !== "complete" && <p>{t("unavailable")}</p>
      )}
    </div>
  );
}
