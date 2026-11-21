import { CircleCheck, CircleDashed, PencilLine } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Callout } from "@/components/site/callout";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { ListRubricsResult } from "@/server/modules/judging";
import { rubricsLocked } from "@/server/modules/judging/domain/rubric-lock";

import { isRefusal } from "../../../_lib/refusal";
import { disciplineRubricHref } from "./_lib/href";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminRubrics.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Params = PageProps<"/admin/competitions/[id]/rubrics">["params"];

export default async function Page({
  params,
}: PageProps<"/admin/competitions/[id]/rubrics">) {
  const t = await getTranslations("adminRubrics");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* The actor is read per request, so the list streams in behind
          this boundary while the heading above is prerendered. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Rubrics params={params} />
      </Suspense>
    </Section>
  );
}

/** Runs the page's use case; undefined when the policy refuses. */
async function load(
  competitionId: string
): Promise<ListRubricsResult | undefined> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    return await as(actor).listRubrics({ competitionId });
  } catch (error) {
    if (isRefusal(error)) return undefined;
    throw error;
  }
}

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

const CARD =
  "flex flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:flex-row sm:items-center sm:justify-between sm:p-6";

async function Rubrics({ params }: { params: Params }) {
  const { id } = await params;
  const [result, t, format] = await Promise.all([
    load(id),
    getTranslations("adminRubrics"),
    getFormatter(),
  ]);
  if (!result) {
    return (
      <ExplainState
        title={t("denied.title")}
        back={{ href: APP_ROUTES.dashboard, label: t("denied.back") }}
        className="mt-8"
      >
        <p>{t("denied.body")}</p>
      </ExplainState>
    );
  }
  if (!result.ok) {
    return (
      <ExplainState
        title={t("notFound.title")}
        back={{ href: APP_ROUTES.dashboard, label: t("notFound.back") }}
        className="mt-8"
      >
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }

  const { competition, disciplines } = result;
  const missing = disciplines
    .filter((entry) => !entry.published)
    .map((entry) => t(`disciplines.${entry.discipline}`));
  const locked = rubricsLocked(competition.status);

  return (
    <div className="mt-8 flex flex-col gap-8">
      <p className="text-lead text-ink">
        {t("index.competition", {
          code: competition.code,
          name: competition.name,
        })}
      </p>
      {locked ? (
        <Callout tone="info">
          <p>{t("index.locked")}</p>
        </Callout>
      ) : missing.length > 0 ? (
        <Callout tone="warning">
          <p>
            {t("index.missing", {
              disciplines: format.list(missing, "and"),
            })}
          </p>
        </Callout>
      ) : (
        <Callout tone="success">
          <p>{t("index.ready")}</p>
        </Callout>
      )}
      <section aria-labelledby="rubrics-list" className="flex flex-col gap-4">
        <h2 id="rubrics-list" className="text-h3 text-ink">
          {t("index.listTitle")}
        </h2>
        <ul className="flex flex-col gap-4">
          {disciplines.map((entry) => {
            const name = t(`disciplines.${entry.discipline}`);
            return (
              <li key={entry.discipline} className={CARD}>
                <div className="flex flex-col gap-2">
                  <h3 className="text-lead font-bold text-ink">{name}</h3>
                  <div className="flex flex-wrap gap-2">
                    {entry.published ? (
                      <Chip
                        tone="green"
                        icon={<CircleCheck aria-hidden="true" />}
                      >
                        {t("index.published", {
                          version: entry.published.version,
                        })}
                      </Chip>
                    ) : null}
                    {entry.draft ? (
                      <Chip
                        tone="marigold"
                        icon={<PencilLine aria-hidden="true" />}
                      >
                        {t("index.draft", { version: entry.draft.version })}
                      </Chip>
                    ) : null}
                    {!entry.published && !entry.draft ? (
                      <Chip icon={<CircleDashed aria-hidden="true" />}>
                        {t("index.none")}
                      </Chip>
                    ) : null}
                  </div>
                </div>
                <SiteLink
                  href={disciplineRubricHref(competition.id, entry.discipline)}
                  className={LINK}
                >
                  {t("index.open", { discipline: name })}
                </SiteLink>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
