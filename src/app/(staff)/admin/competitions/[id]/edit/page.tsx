import { ArrowLeft, Eye } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { StatusCountdown } from "@/components/competitions/status-countdown";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

import {
  CompetitionNotFound,
  CompetitionsDenied,
  DoneNotice,
  StatusChip,
} from "../../_components/admin-states";
import { CompetitionForm } from "../../_components/competition-form";
import { updateCompetitionAction } from "../../_lib/actions";
import { competitionHref } from "../../_lib/href";
import { rawCopy } from "../../_lib/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCompetitions.edit.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/admin/competitions/[id]/edit">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminCompetitions");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      {/* The id and who is asking are read per request: the page streams
          in behind this boundary. */}
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <EditCompetition params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function EditCompetition({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, { done }, t, callout] = await Promise.all([
    params,
    searchParams,
    getTranslations("adminCompetitions"),
    getTranslations("common.callout"),
  ]);
  let result;
  try {
    result = await as(actor).getCompetitionForEdit({ competitionId: id });
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      return <CompetitionsDenied />;
    }
    throw error;
  }
  if (!result.ok) return <CompetitionNotFound />;
  const { competition } = result;
  const action = updateCompetitionAction.bind(null, {
    competitionId: competition.id,
    slug: competition.slug,
  });

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("edit.title", { name: competition.fields.name })}
        lead={t("edit.lead")}
        className="wrap-anywhere"
      />
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <StatusChip status={competition.status} />
        <ButtonLink
          href={competitionHref(competition.id, "preview")}
          variant="secondary"
        >
          <Eye aria-hidden="true" />
          {t("edit.preview")}
        </ButtonLink>
        <ButtonLink href={APP_ROUTES.adminCompetitions} variant="quiet">
          <ArrowLeft aria-hidden="true" />
          {t("edit.back")}
        </ButtonLink>
      </div>
      <StatusCountdown
        change={competition.nextChange}
        now={new Date()}
        className="mt-3"
      />
      <DoneNotice done={done} />
      <div className="mt-8">
        <CompetitionForm
          action={action}
          initial={{ attempt: 0, values: competition.fields, errors: {} }}
          labels={rawCopy(t, "form")}
          vocabulary={rawCopy(t, "vocabulary")}
          problemLabel={callout("danger")}
          submit={{ label: t("form.save"), pending: t("form.saving") }}
        />
      </div>
    </>
  );
}
