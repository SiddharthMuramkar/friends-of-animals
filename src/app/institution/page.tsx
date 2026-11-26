import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { FormAlert } from "@/components/form";
import { DetailList } from "@/components/institutions/detail-list";
import { InstitutionStatusChip } from "@/components/institutions/status-chip";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  INSTITUTION_ARTWORK,
  APP_ROUTES,
  institutionCompetitionsPath,
} from "@/lib/app-routes";
import { formatPhoneNumber } from "@/lib/phone";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

// Render the document on each request so its scripts carry the CSP nonce.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("institutions.mine.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = PageProps<"/institution">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/institution">) {
  await connection();
  const t = await getTranslations("institutions.mine");
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
        <MyInstitution searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function MyInstitution({ searchParams }: { searchParams: SearchParams }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [
    t,
    statuses,
    types,
    callout,
    coordinators,
    registration,
    format,
    mine,
    { registered },
  ] = await Promise.all([
    getTranslations("institutions.mine"),
    getTranslations("institutions.status"),
    getTranslations("institutions.type"),
    getTranslations("common.callout"),
    getTranslations("coordinators.manage"),
    getTranslations("institutionRegistration.competitions"),
    getFormatter(),
    as(actor).getMyInstitution(),
    searchParams,
  ]);

  if (!mine.ok) {
    return (
      <ExplainState
        className="mt-8"
        title={t("none.title")}
        back={{ href: APP_ROUTES.institutionRegister, label: t("none.action") }}
      >
        <p>{t("none.body")}</p>
      </ExplainState>
    );
  }

  const artwork = await getTranslations("artwork");
  const { institution } = mine;
  return (
    <div className="mt-8 flex flex-col gap-8">
      {registered !== undefined &&
      institution.status === "pending_verification" ? (
        <FormAlert tone="success" label={callout("success")}>
          <p>{t("registered")}</p>
        </FormAlert>
      ) : null}

      <section aria-labelledby="institution-status" className={CARD}>
        <h2 id="institution-status" className="text-h3 wrap-anywhere">
          {institution.name}
        </h2>
        <p className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{t("statusLabel")}</span>
          <InstitutionStatusChip
            status={institution.status}
            label={statuses(institution.status)}
          />
        </p>
        <p className="mt-3 text-ink">{t(`explain.${institution.status}`)}</p>
        {institution.institutionCode ? (
          <div className="mt-5">
            <p className="font-semibold text-ink">{t("institutionId")}</p>
            <p className="mt-1 font-display text-h3 tracking-wide">
              {institution.institutionCode}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              {t("institutionIdHint")}
            </p>
          </div>
        ) : null}
        {institution.statusReason ? (
          <div className="mt-5">
            <p className="font-semibold text-ink">{t("reason")}</p>
            <p className="mt-1 text-ink wrap-anywhere">
              {institution.statusReason}
            </p>
          </div>
        ) : null}
        <p className="mt-5 text-sm text-ink-muted">
          {t("registeredOn", {
            date: format.dateTime(institution.registeredAt, "long"),
          })}
          {institution.verifiedAt ? (
            <>
              <br />
              {t("verifiedOn", {
                date: format.dateTime(institution.verifiedAt, "long"),
              })}
            </>
          ) : null}
        </p>
        {institution.status === "rejected" ? (
          <ButtonLink href={APP_ROUTES.institutionRegister} className="mt-5">
            {t("registerAgain")}
          </ButtonLink>
        ) : null}
        {institution.status === "verified" ? (
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href={APP_ROUTES.institutionCoordinators}>
              {coordinators("entry")}
            </ButtonLink>
            <ButtonLink
              href={institutionCompetitionsPath(institution.id)}
              variant="secondary"
            >
              {registration("entry")}
            </ButtonLink>
            <ButtonLink href={INSTITUTION_ARTWORK} variant="secondary">
              {artwork("title")}
            </ButtonLink>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="institution-details" className={CARD}>
        <SectionHeading id="institution-details" title={t("detailsTitle")} />
        <div className="mt-5">
          <DetailList
            items={[
              { label: t("details.type"), value: types(institution.type) },
              {
                label: t("details.address"),
                value: [
                  institution.address,
                  `${institution.city} ${institution.pinCode}`,
                  institution.state,
                  institution.country,
                ].join(", "),
              },
              {
                label: t("details.contactEmail"),
                value: institution.contactEmail,
              },
              {
                label: t("details.contactPhone"),
                value: formatPhoneNumber(institution.contactPhone),
              },
              {
                label: t("details.principalName"),
                value: institution.principalName,
              },
              {
                label: t("details.principalEmail"),
                value: institution.principalEmail,
              },
              {
                label: t("details.principalPhone"),
                value: formatPhoneNumber(institution.principalPhone),
              },
              {
                label: t("details.expectedParticipants"),
                value: format.number(institution.expectedParticipants),
              },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
