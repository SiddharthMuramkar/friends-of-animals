import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SubmitButton, TextAreaField } from "@/components/form";
import { Chip } from "@/components/site/chip";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import {
  CompetitionsDenied,
  CompetitionNotFound,
} from "../../_components/admin-states";
import { changeSchoolRoundAction } from "./_lib/actions";

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const OUTCOMES = [
  "closed",
  "reopened",
  "invalid_input",
  "not_found",
  "competition_not_judging",
  "round_not_overdue",
  "shortlist_only",
  "finalise_blocked",
  "reopen_blocked",
  "forbidden",
  "failed",
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("schoolRound.manager");
  return {
    title: t("title"),
    description: t("lead"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/admin/competitions/[id]/school-rounds">;

export default async function Page(props: Props) {
  const t = await getTranslations("schoolRound");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p>{t("loading")}</p>}>
        <Rounds {...props} />
      </Suspense>
    </Section>
  );
}

async function Rounds({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, { done }, t, status] = await Promise.all([
    params,
    searchParams,
    getTranslations("schoolRound.manager"),
    getTranslations("schoolRound.status"),
  ]);
  let result;
  try {
    result = await as(actor).listSchoolRoundsForManager({ competitionId: id });
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden")
      return <CompetitionsDenied />;
    throw error;
  }
  if (!result.ok) return <CompetitionNotFound />;
  const notice = OUTCOMES.find((code) => code === done);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={result.competitionName}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      <ButtonLink href={APP_ROUTES.adminCompetitions} variant="quiet">
        {t("back")}
      </ButtonLink>
      {notice ? (
        <output className="font-semibold">{t(`outcome.${notice}`)}</output>
      ) : null}
      {result.rounds.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        result.rounds.map((round) => (
          <section
            key={round.id}
            className={CARD}
            aria-labelledby={`round-${round.id} reference-${round.id}`}
          >
            <SectionHeading
              id={`round-${round.id}`}
              title={round.institutionName}
            />
            <p
              id={`reference-${round.id}`}
              className="mt-2 text-sm text-ink-muted"
            >
              {round.reference}
            </p>
            <p className="mt-3">
              <Chip
                tone={
                  round.status === "overdue"
                    ? "pink"
                    : round.status === "open"
                      ? "marigold"
                      : "green"
                }
              >
                {status(round.status)}
              </Chip>
            </p>
            {round.closeReason ? (
              <p className="mt-3">
                {t("recordedReason", { reason: round.closeReason })}
              </p>
            ) : null}
            {round.canClose ? (
              <form
                className="mt-4 flex flex-col gap-3"
                action={changeSchoolRoundAction}
                aria-labelledby={`close-${round.id} round-${round.id} reference-${round.id}`}
              >
                <h3 id={`close-${round.id}`}>{t("close")}</h3>
                <p>{t("closeLead")}</p>
                <input type="hidden" name="competitionId" value={id} />
                <input type="hidden" name="roundId" value={round.id} />
                <input type="hidden" name="operation" value="close" />
                <TextAreaField
                  id={`reason-${round.id}`}
                  name="reason"
                  label={t("reason")}
                  required
                  maxLength={1000}
                />
                <div>
                  <SubmitButton pendingLabel={t("saving")}>
                    {t("close")}
                  </SubmitButton>
                </div>
              </form>
            ) : null}
            {round.canReopen ? (
              <form
                className="mt-4 flex flex-col gap-3"
                action={changeSchoolRoundAction}
                aria-labelledby={`reopen-${round.id} round-${round.id} reference-${round.id}`}
              >
                <h3 id={`reopen-${round.id}`}>{t("reopen")}</h3>
                <p>{t("reopenLead")}</p>
                <input type="hidden" name="competitionId" value={id} />
                <input type="hidden" name="roundId" value={round.id} />
                <input type="hidden" name="operation" value="reopen" />
                <div>
                  <SubmitButton pendingLabel={t("saving")}>
                    {t("reopen")}
                  </SubmitButton>
                </div>
              </form>
            ) : null}
          </section>
        ))
      )}
    </div>
  );
}
