import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { FormAlert } from "@/components/form";
import { DetailList } from "@/components/institutions/detail-list";
import { InstitutionStatusChip } from "@/components/institutions/status-chip";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { formatPhoneNumber } from "@/lib/phone";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import {
  allowedDecisions,
  DECISION_REASON_MAX_LENGTH,
  type InstitutionOutcome,
} from "@/server/institutions";

import { isForbidden } from "../_lib/refused";
import {
  DecisionForm,
  type DecisionFormLabels,
} from "./_components/decision-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminInstitutions.review.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/admin/institutions/[id]">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminInstitutions");
  return (
    <Section hue="neutral" width="prose" className="pt-10 sm:pt-14">
      <ButtonLink
        href={APP_ROUTES.adminInstitutions}
        variant="quiet"
        className="-ms-5 mb-4"
      >
        {t("review.back")}
      </ButtonLink>
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Review params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const OUTCOMES: readonly string[] = [
  "verified",
  "rejected",
  "suspended",
  "reinstated",
] satisfies InstitutionOutcome[];

async function Review({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, { decided }, t, statuses, types, callout, format] =
    await Promise.all([
      params,
      searchParams,
      getTranslations("adminInstitutions"),
      getTranslations("institutions.status"),
      getTranslations("institutions.type"),
      getTranslations("common.callout"),
      getFormatter(),
    ]);

  let result;
  try {
    result = await as(actor).getInstitutionForReview({ institutionId: id });
  } catch (error) {
    if (!isForbidden(error)) throw error;
    return (
      <>
        <PageHeader title={t("title")} />
        <ExplainState
          className="mt-8"
          title={t("forbidden.title")}
          back={{ href: ROUTES.home.path, label: t("forbidden.back") }}
        >
          <p>{t("forbidden.body")}</p>
        </ExplainState>
      </>
    );
  }
  if (!result.ok) {
    return (
      <>
        <PageHeader title={t("review.notFound.title")} />
        <p className="mt-5 max-w-prose text-lead text-ink-muted">
          {t("review.notFound.body")}
        </p>
      </>
    );
  }

  const { institution } = result;
  const decisions = allowedDecisions(institution.status);
  const outcome =
    typeof decided === "string" && OUTCOMES.includes(decided)
      ? (decided as InstitutionOutcome)
      : undefined;
  const labels: DecisionFormLabels = {
    reason: {
      label: t("review.reason.label"),
      hint: t("review.reason.hint", { max: DECISION_REASON_MAX_LENGTH }),
    },
    errors: {
      reason_required: t("review.reason.required"),
      reason_too_long: t("review.reason.tooLong", {
        max: DECISION_REASON_MAX_LENGTH,
      }),
    },
    alerts: {
      transition_not_allowed: t("review.alerts.transition_not_allowed"),
      unexpected: t("review.alerts.unexpected"),
    },
    decide: {
      verify: t("review.decide.verify"),
      reject: t("review.decide.reject"),
      suspend: t("review.decide.suspend"),
    },
    deciding: t("review.deciding"),
    problem: callout("danger"),
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="teal"
        title={institution.name}
        className="wrap-anywhere"
      />
      {outcome ? (
        <FormAlert tone="success" label={callout("success")}>
          <p>
            {t(`review.decided.${outcome}`, {
              code: institution.institutionCode ?? "",
            })}
          </p>
        </FormAlert>
      ) : null}

      <section aria-labelledby="review-details" className={CARD}>
        <SectionHeading id="review-details" title={t("review.detailsTitle")} />
        <p className="mt-4 flex flex-wrap items-center gap-2">
          <InstitutionStatusChip
            status={institution.status}
            label={statuses(institution.status)}
          />
          <span className="text-ink-muted">
            {t("review.registeredOn", {
              date: format.dateTime(institution.registeredAt, "long"),
            })}
          </span>
        </p>
        <div className="mt-5">
          <DetailList
            items={[
              {
                label: t("review.authorisedPerson"),
                value: [
                  institution.authorisedPerson.name,
                  institution.authorisedPerson.email,
                ]
                  .filter(Boolean)
                  .join(", "),
              },
              {
                label: t("review.details.institutionId"),
                value: institution.institutionCode ?? t("table.noId"),
              },
              ...(institution.statusReason
                ? [
                    {
                      label: t("review.details.reason"),
                      value: institution.statusReason,
                    },
                  ]
                : []),
              {
                label: t("review.details.type"),
                value: types(institution.type),
              },
              {
                label: t("review.details.address"),
                value: [
                  institution.address,
                  `${institution.city} ${institution.pinCode}`,
                  institution.state,
                  institution.country,
                ].join(", "),
              },
              {
                label: t("review.details.contactEmail"),
                value: institution.contactEmail,
              },
              {
                label: t("review.details.contactPhone"),
                value: formatPhoneNumber(institution.contactPhone),
              },
              {
                label: t("review.details.principalName"),
                value: institution.principalName,
              },
              {
                label: t("review.details.principalEmail"),
                value: institution.principalEmail,
              },
              {
                label: t("review.details.principalPhone"),
                value: formatPhoneNumber(institution.principalPhone),
              },
              {
                label: t("review.details.expectedParticipants"),
                value: format.number(institution.expectedParticipants),
              },
            ]}
          />
        </div>
      </section>

      <section aria-labelledby="review-decision" className={CARD}>
        <SectionHeading
          id="review-decision"
          title={t("review.decisionTitle")}
        />
        <div className="mt-5">
          {decisions.length === 0 ? (
            <p className="text-ink">{t("review.noDecision")}</p>
          ) : (
            <DecisionForm
              institutionId={institution.id}
              decisions={decisions}
              maxReasonLength={DECISION_REASON_MAX_LENGTH}
              labels={labels}
            />
          )}
        </div>
      </section>
    </div>
  );
}
