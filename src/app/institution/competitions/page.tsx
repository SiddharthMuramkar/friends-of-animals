import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES, slugHref } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type {
  CompetitionForInstitution,
  CompetitionWindow,
} from "@/server/modules/registration";

import { registerForCompetitionAction } from "./_lib/actions";
import {
  actingInstitutions,
  chooseInstitution,
  isRegisterOutcome,
} from "./_lib/register-state";

// Render the document on each request so its scripts carry the CSP nonce
// (#65): `instant = false` lets it build with an empty static shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("institutionRegistration.competitions.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = PageProps<"/institution/competitions">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/institution/competitions">) {
  await connection();
  return (
    <Section hue="pink" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Header />
      {/* The list streams in behind this boundary. */}
      <Suspense fallback={<Loading />}>
        <Competitions searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Header() {
  const t = await getTranslations("institutionRegistration.competitions");
  return (
    <PageHeader
      eyebrow={t("eyebrow")}
      tile="pink"
      title={t("title")}
      lead={t("lead")}
    />
  );
}

async function Loading() {
  const t = await getTranslations("institutionRegistration.competitions");
  return <p className="mt-8 text-ink-muted">{t("loading")}</p>;
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

const WINDOW_TONE = {
  open: "green",
  not_open_yet: "blue",
  closed: "neutral",
} as const satisfies Record<CompetitionWindow, string>;

const param = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

async function Competitions({ searchParams }: { searchParams: SearchParams }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, callout, access, params] = await Promise.all([
    getTranslations("institutionRegistration.competitions"),
    getTranslations("common.callout"),
    as(actor).myAccess(),
    searchParams,
  ]);

  const institutionId = chooseInstitution(
    actingInstitutions(access.grants),
    param(params.institution)
  );
  const list = institutionId
    ? await as(actor).listCompetitionsForInstitution({ institutionId })
    : undefined;
  if (list && !list.ok && list.error === "institution_not_verified") {
    return (
      <ExplainState
        className="mt-8"
        title={t("notVerified.title")}
        back={{ href: APP_ROUTES.dashboard, label: t("notVerified.back") }}
      >
        <p>{t("notVerified.body")}</p>
      </ExplainState>
    );
  }
  if (!list?.ok) {
    return (
      <ExplainState
        className="mt-8"
        title={t("noInstitution.title")}
        back={{ href: APP_ROUTES.dashboard, label: t("noInstitution.back") }}
      >
        <p>{t("noInstitution.body")}</p>
      </ExplainState>
    );
  }

  const done = isRegisterOutcome(params.done) ? params.done : undefined;
  const chosen = list.competitions.find(
    (each) => each.id === param(params.competition)
  );
  const outcomeMessage =
    done !== "registered"
      ? done && t(`outcome.${done}`)
      : chosen?.registration
        ? t("outcome.registered", {
            institution: list.institution.name,
            competition: chosen.name,
            reference: chosen.registration.reference,
          })
        : t("outcome.registeredElsewhere");

  return (
    <div className="mt-8 flex flex-col gap-10">
      <p className="text-lead font-semibold text-ink wrap-anywhere">
        {t("for", { institution: list.institution.name })}
      </p>

      {done && outcomeMessage ? (
        <OutcomeNotice
          key={param(params.n) ?? done}
          tone={done === "registered" ? "success" : "danger"}
          label={done === "registered" ? callout("success") : callout("danger")}
          message={outcomeMessage}
        />
      ) : null}

      <section aria-labelledby="competitions-list">
        <SectionHeading id="competitions-list" title={t("listTitle")} />
        {list.competitions.length === 0 ? (
          <p className="mt-4 text-ink-muted">{t("empty")}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {list.competitions.map((competition) => (
              <li key={competition.id} className={CARD}>
                <CompetitionCard
                  competition={competition}
                  institution={list.institution}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function CompetitionCard({
  competition,
  institution,
}: {
  competition: CompetitionForInstitution;
  institution: { id: string; name: string };
}) {
  const [t, format] = await Promise.all([
    getTranslations("institutionRegistration.competitions"),
    getFormatter(),
  ]);
  const when = (at: Date | null) =>
    at ? format.dateTime(at, "longDateTime") : null;
  const opens = when(competition.opensAt);
  const closes = when(competition.closesAt);
  const dates =
    competition.window === "not_open_yet"
      ? opens && t("opens", { date: opens })
      : competition.window === "open"
        ? closes && t("closes", { date: closes })
        : closes && t("closedOn", { date: closes });
  const headingId = `competition-${competition.id}`;

  return (
    <article aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={headingId} className="text-h3 wrap-anywhere">
          {competition.name}
        </h3>
        <Chip tone={WINDOW_TONE[competition.window]}>
          {t(`window.${competition.window}`)}
        </Chip>
      </div>
      <p className="mt-1 font-mono text-sm text-ink-muted">
        {competition.code}
      </p>

      {dates ? <p className="mt-3 text-ink">{dates}</p> : null}

      {competition.registration ? (
        <div className="mt-5">
          <p className="font-semibold text-ink">{t("registered")}</p>
          <p className="mt-3 font-semibold text-ink">{t("reference")}</p>
          <p className="mt-1 font-display text-h3 tracking-wide">
            {competition.registration.reference}
          </p>
          <p className="mt-1 text-sm text-ink-muted">{t("referenceHint")}</p>
        </div>
      ) : competition.window === "open" ? (
        <form action={registerForCompetitionAction} className="mt-5">
          <input type="hidden" name="institutionId" value={institution.id} />
          <input type="hidden" name="competitionId" value={competition.id} />
          <SubmitButton pendingLabel={t("registering")}>
            {/* One sentence for screen readers, starting with the visible
                word (WCAG 2.5.3). */}
            <span aria-hidden="true">{t("register")}</span>
            <span className="sr-only">
              {t("registerFor", {
                institution: institution.name,
                competition: competition.name,
              })}
            </span>
          </SubmitButton>
        </form>
      ) : null}

      <p className="mt-4">
        <SiteLink
          href={slugHref("competition", competition.slug)}
          className={LINK}
        >
          <span aria-hidden="true">{t("about")}</span>
          <span className="sr-only">
            {t("aboutName", { competition: competition.name })}
          </span>
        </SiteLink>
      </p>
    </article>
  );
}
