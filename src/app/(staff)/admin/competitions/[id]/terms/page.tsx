import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { FormAlert } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import type { Messages } from "@/i18n/messages";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

import {
  CompetitionNotFound,
  CompetitionsDenied,
} from "../../_components/admin-states";
import { competitionHref } from "../../_lib/href";
import { DocumentsSection } from "./_components/documents-section";
import { FeesForm } from "./_components/fees-form";
import { RoundAwardsForm } from "./_components/round-awards-form";
import { saveFeesAction, saveRoundAwardsAction } from "./_lib/actions";
import { awardsEnteredFrom, feesEnteredFrom } from "./_lib/form-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCompetitionTerms.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/admin/competitions/[id]/terms">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminCompetitionTerms");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      {/* The id and who is asking are read per request: the page streams
          in behind this boundary. */}
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <CompetitionTermsPage params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

/** One of the page's three parts, as a card under its own heading. */
function Part({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={`${CARD} flex flex-col gap-5`}>
      <div>
        <h2 id={id} className="text-h3">
          {title}
        </h2>
        <p className="mt-2 text-ink-muted">{lead}</p>
      </div>
      {children}
    </section>
  );
}

const DOCUMENT_OUTCOMES = ["saved", "failed"] as const;

type Copy = Messages["adminCompetitionTerms"];

async function CompetitionTermsPage({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, { documents: outcome }, t, publicWords, callout] =
    await Promise.all([
      params,
      searchParams,
      getTranslations("adminCompetitionTerms"),
      getTranslations("competitionTerms"),
      getTranslations("common.callout"),
    ]);
  let result;
  try {
    result = await as(actor).getCompetitionTermsForEdit({ competitionId: id });
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      return <CompetitionsDenied />;
    }
    throw error;
  }
  if (!result.ok) return <CompetitionNotFound />;
  const { competition, fees, awards, documents } = result.terms;
  // Client Components take their words as props; next-intl types raw()
  // for leaf keys only.
  const raw = <K extends keyof Copy>(key: K) =>
    (t.raw as (key: K) => Copy[K])(key);
  const copy = {
    fees: raw("fees"),
    awards: raw("awards"),
    saved: t("saved"),
    unchanged: t("unchanged"),
    failed: t("failed"),
  };
  const awardWords = (
    publicWords.raw as (key: "awards") => Messages["competitionTerms"]["awards"]
  )("awards");
  const alerts = { success: callout("success"), danger: callout("danger") };
  const documentOutcome = DOCUMENT_OUTCOMES.find((each) => each === outcome);

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      <p className="mt-4 font-semibold text-ink wrap-anywhere">
        {t("forCompetition", {
          name: competition.name,
          code: competition.code,
        })}
      </p>
      <div className="mt-6">
        <ButtonLink
          href={competitionHref(competition.id, "edit")}
          variant="quiet"
        >
          <ArrowLeft aria-hidden="true" />
          {t("back")}
        </ButtonLink>
      </div>

      <div className="mt-8 flex flex-col gap-8">
        <Part id="terms-fees" title={t("fees.heading")} lead={t("fees.lead")}>
          {fees.lines.length === 0 ? (
            <p className="text-ink">{t("fees.noParticipation")}</p>
          ) : (
            <FeesForm
              action={saveFeesAction}
              competitionId={competition.id}
              routes={fees.lines.map((line) => line.route)}
              initial={feesEnteredFrom(fees.lines)}
              editable={fees.editable}
              copy={copy}
              callout={alerts}
            />
          )}
        </Part>

        <Part
          id="terms-awards"
          title={t("awards.heading")}
          lead={t("awards.lead")}
        >
          {awards.map((round) => (
            <section
              key={round.roundKey}
              aria-labelledby={`awards-${round.roundKey}`}
              className="flex flex-col gap-4 border-t-2 border-border pt-5 first:border-t-0 first:pt-0"
            >
              <h3 id={`awards-${round.roundKey}`} className="text-h4">
                {publicWords(`awards.round.${round.roundKey}`)}
              </h3>
              <RoundAwardsForm
                action={saveRoundAwardsAction}
                competitionId={competition.id}
                round={round.roundKey}
                initial={awardsEnteredFrom(round)}
                copy={copy}
                words={awardWords}
                callout={alerts}
              />
            </section>
          ))}
        </Part>

        <Part
          id="terms-documents"
          title={t("documents.heading")}
          lead={t("documents.lead")}
        >
          {documentOutcome ? (
            <FormAlert
              tone={documentOutcome === "saved" ? "success" : "danger"}
              label={
                documentOutcome === "saved" ? alerts.success : alerts.danger
              }
            >
              <p>{t(documentOutcome)}</p>
            </FormAlert>
          ) : null}
          <DocumentsSection
            competitionId={competition.id}
            documents={documents}
          />
        </Part>
      </div>
    </>
  );
}
