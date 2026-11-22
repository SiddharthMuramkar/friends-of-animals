import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { RubricCriteriaTable } from "@/components/judging/rubric-criteria-table";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { GetJudgingGuideResult } from "@/server/modules/judging";

// The judging guide (#88): FOA's framework, then the published rubric of
// each discipline, for coordinators of registered institutions before
// their school round opens.

// Render the document on each request so its scripts carry the CSP nonce.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judgingGuide.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Params =
  PageProps<"/institution/competitions/[code]/judging-guide">["params"];

export default async function Page({
  params,
}: PageProps<"/institution/competitions/[code]/judging-guide">) {
  await connection();
  const t = await getTranslations("judgingGuide");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Guide params={params} />
      </Suspense>
    </Section>
  );
}

/** Runs the page's use case; undefined when the policy refuses. */
async function load(code: string): Promise<GetJudgingGuideResult | undefined> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    return await as(actor).getJudgingGuide({ code });
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      return undefined;
    }
    throw error;
  }
}

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

const CARD =
  "flex flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function Guide({ params }: { params: Params }) {
  const { code } = await params;
  const [result, t, format] = await Promise.all([
    load(decodeURIComponent(code)),
    getTranslations("judgingGuide"),
    getFormatter(),
  ]);
  const back = { href: APP_ROUTES.dashboard, label: t("back") };
  if (!result) {
    return (
      <ExplainState title={t("denied.title")} back={back} className="mt-8">
        <p>{t("denied.body")}</p>
      </ExplainState>
    );
  }
  if (!result.ok) {
    return (
      <ExplainState title={t("notFound.title")} back={back} className="mt-8">
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }

  const { competition, disciplines } = result;
  const framework = t.raw("framework.items") as string[];
  return (
    <div className="mt-8 flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <SiteLink href={APP_ROUTES.dashboard} className={LINK}>
          {t("back")}
        </SiteLink>
        <p className="text-lead text-ink wrap-anywhere">
          {t("competition", { code: competition.code, name: competition.name })}
        </p>
      </div>

      <section aria-labelledby="framework" className={CARD}>
        <SectionHeading id="framework" title={t("framework.title")} />
        <ol className="flex list-decimal flex-col gap-2 ps-6 text-ink">
          {framework.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="rubrics" className="flex flex-col gap-6">
        <h2 id="rubrics" className="text-h3 text-ink">
          {t("rubrics.title")}
        </h2>
        {disciplines.map(({ discipline, rubric }) => {
          const name = t(`disciplines.${discipline}`);
          return (
            <article
              key={discipline}
              aria-labelledby={`rubric-${discipline}`}
              className={CARD}
            >
              <h3
                id={`rubric-${discipline}`}
                className="text-lead font-bold text-ink"
              >
                {name}
              </h3>
              {rubric ? (
                <>
                  <p className="text-ink-muted">
                    {t("rubrics.version", {
                      version: rubric.version,
                      date: format.dateTime(rubric.publishedAt, "long"),
                    })}
                  </p>
                  <RubricCriteriaTable
                    id={`criteria-${discipline}`}
                    caption={t("rubrics.caption", { discipline: name })}
                    headings={{
                      label: t("table.label"),
                      description: t("table.description"),
                      weight: t("table.weight"),
                      scores: t("table.scores"),
                    }}
                    rows={rubric.criteria.map((criterion) => ({
                      label: criterion.label,
                      description: criterion.description,
                      weight: t("table.weightValue", {
                        weight: criterion.weight,
                      }),
                      scores: t("table.scoreRange", {
                        min: criterion.minScore,
                        max: criterion.maxScore,
                      }),
                    }))}
                  />
                </>
              ) : (
                <p className="text-ink">{t("rubrics.none")}</p>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}
