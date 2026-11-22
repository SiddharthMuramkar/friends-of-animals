import { ArrowLeft, ExternalLink, PencilLine } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { FormAlert, SubmitButton } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES, slugHref } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

import {
  CompetitionNotFound,
  CompetitionsDenied,
  DoneNotice,
  StatusChip,
} from "../../_components/admin-states";
import { CompetitionDetail } from "../../_components/competition-detail";
import { publishCompetitionAction } from "../../_lib/actions";
import { problemMessage } from "../../_lib/form-view";
import { competitionHref } from "../../_lib/href";
import { translate } from "../../_lib/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCompetitions.preview.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/admin/competitions/[id]/preview">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminCompetitions");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <PreviewCompetition params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const REFUSALS = ["not_found", "not_draft", "not_ready", "refused"] as const;

async function PreviewCompetition({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, { done, refused }, t, callout] = await Promise.all([
    params,
    searchParams,
    getTranslations("adminCompetitions"),
    getTranslations("common.callout"),
  ]);
  let views;
  try {
    // The name for the heading comes from the edit view: a draft with
    // gaps has no public view to take it from.
    views = await Promise.all([
      as(actor).previewCompetition({ competitionId: id }),
      as(actor).getCompetitionForEdit({ competitionId: id }),
    ]);
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      return <CompetitionsDenied />;
    }
    throw error;
  }
  const [result, edit] = views;
  if (!result.ok || !edit.ok) return <CompetitionNotFound />;
  const name = edit.competition.fields.name;
  const refusal = REFUSALS.find((each) => each === refused);
  const draft = result.status === "draft";

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("preview.title", { name })}
        lead={draft ? t("preview.leadDraft") : t("preview.leadPublished")}
        className="wrap-anywhere"
      />
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <StatusChip status={result.status} />
        <ButtonLink href={competitionHref(id, "edit")} variant="secondary">
          <PencilLine aria-hidden="true" />
          {t("preview.edit")}
        </ButtonLink>
        {!draft && result.competition ? (
          <ButtonLink
            href={slugHref("competition", result.competition.slug)}
            variant="secondary"
          >
            <ExternalLink aria-hidden="true" />
            {t("preview.publicPage")}
          </ButtonLink>
        ) : null}
        <ButtonLink href={APP_ROUTES.adminCompetitions} variant="quiet">
          <ArrowLeft aria-hidden="true" />
          {t("preview.back")}
        </ButtonLink>
      </div>
      <DoneNotice done={done} />
      {refusal ? (
        <FormAlert tone="danger" label={callout("danger")} className="mt-8">
          <p>{t(`alerts.${refusal}`)}</p>
        </FormAlert>
      ) : null}

      {result.problems.length > 0 ? (
        <section aria-labelledby="preview-problems" className={`${CARD} mt-8`}>
          <SectionHeading
            id="preview-problems"
            title={t("preview.problemsTitle")}
          />
          <p className="mt-3 text-ink-muted">{t("preview.problemsLead")}</p>
          <ul className="mt-4 list-disc pl-6 text-ink">
            {result.problems.map((problem, index) => (
              <li key={index}>
                {translate(t, problemMessage(problem).message)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {draft && result.problems.length === 0 ? (
        <section aria-labelledby="preview-publish" className={`${CARD} mt-8`}>
          <SectionHeading
            id="preview-publish"
            title={t("preview.publishTitle")}
          />
          <p className="mt-3 text-ink-muted">{t("preview.publishLead")}</p>
          <form
            action={publishCompetitionAction.bind(null, id)}
            className="mt-4"
          >
            <SubmitButton pendingLabel={t("preview.publishing")}>
              {t("preview.publish")}
            </SubmitButton>
          </form>
        </section>
      ) : null}

      {result.competition ? (
        <div className="mt-8">
          <CompetitionDetail competition={result.competition} />
        </div>
      ) : null}
    </>
  );
}
