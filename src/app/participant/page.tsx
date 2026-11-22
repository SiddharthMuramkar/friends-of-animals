import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { payMyRegistrationPath } from "@/lib/app-routes";
import { ROUTES, slugHref } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { MyRegistration } from "@/server/modules/participants";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import type { RegistrationStatus } from "@/server/modules/registration";

// The participant dashboard (#78): an adult's own registrations and where
// each stands. Entries, results and certificates join it later.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("participant.dashboard.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const HUE = ROUTES.participate.hue;

const STATUS_TONE = {
  enrolled: "green",
  confirmed: "blue",
  withdrawn: "neutral",
  pending_payment: "marigold",
} as const satisfies Record<RegistrationStatus, string>;

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

export default async function Page() {
  const t = await getTranslations("participant.dashboard");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile={HUE}
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Registrations />
      </Suspense>
    </Section>
  );
}

async function Registrations() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [mine, t] = await Promise.all([
    as(actor).listMyRegistrations(),
    getTranslations("participant.dashboard"),
  ]);
  if (mine.length === 0) {
    return (
      <div className={`${CARD} mt-8`}>
        <p className="text-ink">{t("empty")}</p>
        <div className="mt-4">
          <ButtonLink href={ROUTES.participate.path}>
            {t("findCompetition")}
          </ButtonLink>
        </div>
      </div>
    );
  }
  return (
    <>
      <p className="mt-8 text-lead font-semibold text-ink">
        {t("participantId", { code: mine[0]!.participantCode })}
      </p>
      <ul className="mt-6 flex flex-col gap-4">
        {mine.map((registration) => (
          <li key={registration.registrationId}>
            <RegistrationCard registration={registration} />
          </li>
        ))}
      </ul>
      <p className="mt-6 text-ink-muted">{t("comingSoon")}</p>
    </>
  );
}

async function RegistrationCard({
  registration,
}: {
  registration: MyRegistration;
}) {
  const [t, status, format] = await Promise.all([
    getTranslations("participant.dashboard"),
    getTranslations("registration.status"),
    getFormatter(),
  ]);
  const { competition, amountDue } = registration;
  const headingId = `registration-${registration.registrationId}`;
  return (
    <article aria-labelledby={headingId} className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-h4 leading-tight">
          <SiteLink
            href={slugHref("competition", competition.slug)}
            className="text-link underline decoration-2 underline-offset-4 hover:text-link-hover"
          >
            {competition.name}
          </SiteLink>
        </h2>
        <Chip tone={STATUS_TONE[registration.status]}>
          {status(registration.status)}
        </Chip>
      </div>
      {registration.registrationNumber ? (
        <p className="mt-3 font-semibold text-ink">
          {t("registrationNumber", { number: registration.registrationNumber })}
        </p>
      ) : null}
      <p className="mt-2 text-sm text-ink-muted">
        {t("registeredOn", {
          date: format.dateTime(registration.createdAt, {
            dateStyle: "long",
            timeZone: "Asia/Kolkata",
          }),
        })}
      </p>
      {amountDue ? (
        <div className="mt-4">
          <ButtonLink href={payMyRegistrationPath(registration.registrationId)}>
            {amountDue.amountMinor === 0n
              ? t("confirmFree", { competition: competition.name })
              : t("pay", {
                  amount: formatPaise(amountDue.amountMinor),
                  competition: competition.name,
                })}
          </ButtonLink>
        </div>
      ) : null}
    </article>
  );
}
