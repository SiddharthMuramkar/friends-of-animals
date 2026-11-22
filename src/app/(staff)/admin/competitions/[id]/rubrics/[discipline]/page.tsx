import { CircleCheck, History, PencilLine } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { FormAlert, SubmitButton } from "@/components/form";
import { RubricCriteriaTable } from "@/components/judging/rubric-criteria-table";
import { Callout } from "@/components/site/callout";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import {
  DISCIPLINES,
  type Discipline,
} from "@/server/modules/competitions/domain/vocabulary";
import type {
  GetDisciplineRubricsResult,
  RubricStatus,
  RubricView,
} from "@/server/modules/judging";

import { isRefusal } from "../../../../_lib/refusal";
import { RubricEditor } from "../_components/rubric-editor";
import { reviseRubricAction, startRubricAction } from "../_lib/actions";
import { MAX_ROWS } from "../_lib/criteria-form";
import { draftView, weightTotal } from "../_lib/editor-view";
import { readOutcome, rubricsHref } from "../_lib/href";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminRubrics.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/admin/competitions/[id]/rubrics/[discipline]">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminRubrics");
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
        <DisciplineRubric params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

function isDiscipline(value: string): value is Discipline {
  return (DISCIPLINES as readonly string[]).includes(value);
}

/** Runs the page's use case; undefined when the policy refuses. */
async function load(
  competitionId: string,
  discipline: Discipline
): Promise<GetDisciplineRubricsResult | undefined> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    return await as(actor).getDisciplineRubrics({ competitionId, discipline });
  } catch (error) {
    if (isRefusal(error)) return undefined;
    throw error;
  }
}

const CARD =
  "flex flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

const STATUS_CHIP = {
  draft: { tone: "marigold", Icon: PencilLine },
  published: { tone: "green", Icon: CircleCheck },
  superseded: { tone: "neutral", Icon: History },
} as const satisfies Record<RubricStatus, unknown>;

async function DisciplineRubric({
  params,
  searchParams,
}: {
  params: Props["params"];
  searchParams: Props["searchParams"];
}) {
  const [{ id, discipline: rawDiscipline }, query, t, common, format] =
    await Promise.all([
      params,
      searchParams,
      getTranslations("adminRubrics"),
      getTranslations("common.callout"),
      getFormatter(),
    ]);

  const back = { href: rubricsHref(id), label: t("noDiscipline.back") };
  if (!isDiscipline(rawDiscipline)) {
    return (
      <ExplainState
        title={t("noDiscipline.title")}
        back={back}
        className="mt-8"
      >
        <p>{t("noDiscipline.body")}</p>
      </ExplainState>
    );
  }
  const discipline = rawDiscipline;
  const result = await load(id, discipline);
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
    return result.error === "discipline_not_enabled" ? (
      <ExplainState
        title={t("noDiscipline.title")}
        back={back}
        className="mt-8"
      >
        <p>{t("noDiscipline.body")}</p>
      </ExplainState>
    ) : (
      <ExplainState
        title={t("notFound.title")}
        back={{ href: APP_ROUTES.dashboard, label: t("notFound.back") }}
        className="mt-8"
      >
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }

  const { competition, rubrics, locked } = result;
  const name = t(`disciplines.${discipline}`);
  const draft = rubrics.find((rubric) => rubric.status === "draft");
  const published = rubrics.find((rubric) => rubric.status === "published");
  const outcome = readOutcome(query);
  const target = (
    <>
      <input type="hidden" name="competitionId" value={competition.id} />
      <input type="hidden" name="discipline" value={discipline} />
    </>
  );

  const rows = (rubric: RubricView) =>
    rubric.criteria.map((criterion) => ({
      label: criterion.label,
      description: criterion.description,
      weight: t("table.weightValue", { weight: criterion.weight }),
      scores: t("table.scoreRange", {
        min: criterion.minScore,
        max: criterion.maxScore,
      }),
    }));

  const initial = draft ? draftView(draft.criteria) : undefined;

  return (
    <div className="mt-8 flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <SiteLink href={rubricsHref(competition.id)} className={LINK}>
          {t("discipline.back", { code: competition.code })}
        </SiteLink>
        <h2 className="text-h2 text-ink">
          {t("discipline.title", { discipline: name })}
        </h2>
      </div>

      {outcome && "done" in outcome ? (
        <FormAlert tone="success" label={t("done.label")} key={outcome.at}>
          <p>{t(`done.${outcome.done}`)}</p>
        </FormAlert>
      ) : null}
      {outcome && "refused" in outcome ? (
        <FormAlert tone="danger" label={common("danger")} key={outcome.at}>
          <p>{t(`refusals.${outcome.refused}`)}</p>
        </FormAlert>
      ) : null}
      {locked ? (
        <Callout tone="info">
          <p>{t("discipline.lockedNote")}</p>
        </Callout>
      ) : null}

      {rubrics.length === 0 && !locked ? (
        <div className={CARD}>
          <p className="text-ink">{t("discipline.none")}</p>
          <form action={startRubricAction}>
            {target}
            <SubmitButton pendingLabel={t("discipline.starting")}>
              {t("discipline.start")}
            </SubmitButton>
          </form>
        </div>
      ) : null}

      {draft && initial && !locked ? (
        <section aria-labelledby="rubric-draft" className="flex flex-col gap-4">
          <h3 id="rubric-draft" className="text-h3 text-ink">
            {t("discipline.draftTitle", { version: draft.version })}
          </h3>
          <p className="text-ink-muted">{t("discipline.draftLead")}</p>
          <RubricEditor
            competitionId={competition.id}
            discipline={discipline}
            rubricId={draft.id}
            initial={{
              ...initial,
              total: t("editor.total", { total: weightTotal(initial.rows) }),
            }}
            labels={{
              // One per row a refused save can come back with, not
              // only the draft's, so every row's fieldset has a name.
              rowTitles: Array.from({ length: MAX_ROWS }, (_, index) =>
                t("editor.rowTitle", { number: index + 1 })
              ),
              newRowTitle: t("editor.newRowTitle"),
              label: t("editor.label"),
              description: t("editor.description"),
              descriptionHint: t("editor.descriptionHint"),
              weight: t("editor.weight"),
              minScore: t("editor.minScore"),
              maxScore: t("editor.maxScore"),
              remove: t("editor.remove"),
              newRowsHint: t("editor.newRowsHint"),
              save: t("editor.save"),
              saving: t("editor.saving"),
              publish: t("editor.publish"),
              publishing: t("editor.publishing"),
              problem: common("danger"),
            }}
          />
        </section>
      ) : null}

      {published && !draft && !locked ? (
        <section aria-labelledby="rubric-revise" className={CARD}>
          <h3 id="rubric-revise" className="text-lead font-bold text-ink">
            {t("discipline.reviseTitle")}
          </h3>
          <p className="text-ink">{t("discipline.reviseLead")}</p>
          <form action={reviseRubricAction}>
            {target}
            <input type="hidden" name="rubricId" value={published.id} />
            <SubmitButton
              variant="secondary"
              pendingLabel={t("discipline.revising")}
            >
              {t("discipline.revise", { version: published.version + 1 })}
            </SubmitButton>
          </form>
        </section>
      ) : null}

      {rubrics.some((rubric) => rubric.status !== "draft") ? (
        <section
          aria-labelledby="rubric-history"
          className="flex flex-col gap-6"
        >
          <h3 id="rubric-history" className="text-h3 text-ink">
            {t("discipline.historyTitle")}
          </h3>
          {rubrics
            .filter((rubric) => rubric.status !== "draft")
            .map((rubric) => {
              const { tone, Icon } = STATUS_CHIP[rubric.status];
              return (
                <article
                  key={rubric.id}
                  aria-labelledby={`version-${rubric.version}`}
                  className="flex flex-col gap-3"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <h4
                      id={`version-${rubric.version}`}
                      className="text-lead font-bold text-ink"
                    >
                      {t("table.caption", { version: rubric.version })}
                    </h4>
                    <Chip tone={tone} icon={<Icon aria-hidden="true" />}>
                      {t(`status.${rubric.status}`)}
                    </Chip>
                  </div>
                  {rubric.publishedAt ? (
                    <p className="text-ink-muted">
                      {t("discipline.publishedOn", {
                        date: format.dateTime(
                          rubric.publishedAt,
                          "longDateTime"
                        ),
                      })}
                    </p>
                  ) : null}
                  {rubric.criteria.length > 0 ? (
                    <RubricCriteriaTable
                      id={`criteria-${rubric.version}`}
                      caption={t("table.caption", { version: rubric.version })}
                      headings={{
                        label: t("table.label"),
                        description: t("table.description"),
                        weight: t("table.weight"),
                        scores: t("table.scores"),
                      }}
                      rows={rows(rubric)}
                    />
                  ) : (
                    <p className="text-ink-muted">
                      {t("discipline.noCriteria")}
                    </p>
                  )}
                </article>
              );
            })}
        </section>
      ) : null}
    </div>
  );
}
