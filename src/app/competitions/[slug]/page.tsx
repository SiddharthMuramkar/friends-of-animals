import { Check, ChevronRight, Mail } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CertificatePreview } from "@/components/showcase/certificate-preview";
import { cachedNow } from "@/components/showcase/clock";
import { JudgingPath } from "@/components/showcase/judging-path";
import { QuoteFigure } from "@/components/showcase/quote-figure";
import { StatusChip } from "@/components/showcase/status-chip";
import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { Eyebrow, SectionHeading } from "@/components/site/heading";
import { JsonLd } from "@/components/site/json-ld";
import { Photo } from "@/components/site/photo";
import { Placeholder } from "@/components/site/placeholder";
import { SampleTag } from "@/components/site/sample-tag";
import { Section } from "@/components/site/section";
import { TileMarker } from "@/components/site/tile";
import { SAMPLE_WELFARE } from "@/content/competitions/welfare";
import { getSampleCompetitions } from "@/content/sample";
import type { Competition } from "@/content/sample/model";
import { ageRange, feeDisplay, nextKeyDate } from "@/content/sample/selectors";
import { siteUrl } from "@/env";
import { ROUTES, slugHref } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { placeholder, SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

import { EasyRead } from "../_components/easy-read";
import {
  competitionParams,
  fileRules,
  primaryAction,
  timeline,
} from "../_lib/view";

const HUE = ROUTES.competition.hue;
const LINK =
  "font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

function listed(): readonly Competition[] {
  return getSampleCompetitions().filter((c) => c.status !== "DRAFT");
}

function find(slug: string): Competition | undefined {
  return listed().find((c) => c.slug === slug);
}

export function generateStaticParams() {
  return competitionParams(listed());
}

export async function generateMetadata({
  params,
}: PageProps<"/competitions/[slug]">): Promise<Metadata> {
  const c = find((await params).slug);
  if (!c) return {};
  return pageMetadata({
    title: c.name,
    description: c.theme,
    path: slugHref("competition", c.slug),
  });
}

async function Fee({
  fee,
}: {
  fee: Competition["routes"][number]["feeBaseMinor"];
}) {
  const t = await getTranslations("competitions.detail");
  const shown = feeDisplay(fee);
  if (shown.kind === "placeholder")
    return <Placeholder fact={placeholder(shown.key)} />;
  return (
    <span className="font-display font-semibold text-ink">
      {shown.kind === "free" ? t("free") : shown.text}
    </span>
  );
}

export default async function Page({
  params,
}: PageProps<"/competitions/[slug]">) {
  const c = find((await params).slug);
  if (!c) notFound();

  const t = await getTranslations("competitions.detail");
  const tc = await getTranslations("competitions");
  const ts = await getTranslations("sample");
  const format = await getFormatter();
  const now = new Date(await cachedNow());
  const date = (iso: string) => format.dateTime(new Date(iso), "long");

  const ages = ageRange(c);
  const next = nextKeyDate(c, now);
  const action = primaryAction(c.status);
  const steps = timeline(c, now);
  const welfare = SAMPLE_WELFARE[c.slug] ?? [];
  const actionLabel =
    action === "opensSoon"
      ? t("action.opensSoon.label", { date: date(c.registrationOpensAt) })
      : t(`action.${action}.label`);
  const route = (r: "INSTITUTION" | "INDIVIDUAL") =>
    c.routes.find((x) => x.route === r);
  const school = route("INSTITUTION");
  const self = route("INDIVIDUAL");
  const base = siteUrl();

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Event",
          name: c.name,
          description: c.theme,
          startDate: c.conductStartsAt,
          endDate: c.submissionClosesAt,
          eventStatus:
            c.status === "CANCELLED"
              ? "https://schema.org/EventCancelled"
              : "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/MixedEventAttendanceMode",
          location: {
            "@type": "VirtualLocation",
            url: new URL(slugHref("competition", c.slug), base).href,
          },
          organizer: {
            "@type": "NGO",
            name: SITE.name,
            url: new URL("/", base).href,
          },
        }}
      />

      <Section hue={HUE} tone="tint" className="pt-8 sm:pt-10">
        <nav aria-label={t("breadcrumb")}>
          <ol className="flex flex-wrap items-center gap-1 text-sm">
            <li>
              <Link
                href={ROUTES.competitions.path}
                className="inline-flex min-h-6 items-center text-link underline underline-offset-2 hover:text-link-hover"
              >
                {tc("meta.title")}
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-4 text-ink-muted" />
            </li>
            <li aria-current="page" className="text-ink-muted">
              {c.name}
            </li>
          </ol>
        </nav>

        <div className="mt-8 grid items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={c.status} />
              <SampleTag />
            </div>
            <h1 className="mt-4 text-(--section-heading,var(--ink))">
              {c.name}
            </h1>
            <p className="mt-5 max-w-prose text-lead text-ink">{c.theme}</p>

            <ButtonLink href="#take-part" size="lg" className="mt-8">
              {actionLabel}
            </ButtonLink>

            <dl
              aria-label={t("facts")}
              className="mt-8 grid max-w-xl grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 rounded-3xl bg-surface p-5 shadow-warm sm:p-6"
            >
              <dt className="font-semibold text-ink">{t("ages")}</dt>
              <dd className="text-ink-muted">{t("ageRange", ages)}</dd>
              <dt className="font-semibold text-ink">{t("disciplines")}</dt>
              <dd className="text-ink-muted">
                {format.list(
                  c.disciplines.map((d) => ts(`discipline.${d}`)),
                  "and"
                )}
              </dd>
              <dt className="font-semibold text-ink">{t("nextDate")}</dt>
              <dd className="text-ink-muted">
                {next
                  ? `${t(`timeline.steps.${next.kind}`)}: ${date(next.at)}`
                  : t("noNextDate")}
              </dd>
            </dl>
          </div>
          <Photo
            id={c.coverImageId}
            sizes="(min-width: 1024px) 40vw, 92vw"
            preload
            frame="blue"
            frameCorner="top-right"
            className="aspect-4/3"
            figureClassName="mx-auto w-full max-w-lg"
          />
        </div>
      </Section>

      <Section labelledBy="theme-title" hue={HUE}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
          <div>
            <Eyebrow tile="pink">{t("theme.eyebrow")}</Eyebrow>
            <h2
              id="theme-title"
              className="mt-2 text-(--section-heading,var(--ink))"
            >
              {t("theme.welfare")}
            </h2>
          </div>
          {welfare.length > 0 ? (
            <EasyRead label={tc("easyRead")}>
              {welfare.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </EasyRead>
          ) : null}
        </div>
      </Section>

      <Section labelledBy="categories-title" hue={HUE} tone="tint">
        <SectionHeading
          id="categories-title"
          title={t("categories.title")}
          lead={t("categories.lead", {
            date: date(`${c.ageCutoffDate}T00:00:00+05:30`),
          })}
        />
        <div className="mt-8 overflow-hidden rounded-3xl border-2 border-border bg-surface">
          <table className="w-full text-left">
            <caption className="sr-only">{t("categories.caption")}</caption>
            <thead className="bg-surface-muted text-sm">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold">
                  {t("categories.discipline")}
                </th>
                {c.ageGroups.map((g) => (
                  <th
                    key={g.label}
                    scope="col"
                    className="px-5 py-3 font-semibold"
                  >
                    {g.label}
                    <span className="block font-normal text-ink-muted">
                      {t("categories.groupAges", {
                        min: g.minAge,
                        max: g.maxAge,
                      })}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.disciplines.map((d) => (
                <tr key={d} className="border-t border-border">
                  <th scope="row" className="px-5 py-3 font-semibold">
                    {ts(`discipline.${d}`)}
                  </th>
                  {c.ageGroups.map((g) => (
                    <td key={g.label} className="px-5 py-3">
                      <Check
                        aria-label={`${ts(`discipline.${d}`)}, ${g.label}`}
                        className="size-5 text-green-700 dark:text-green-300"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section labelledBy="dates-title" hue={HUE}>
        <SectionHeading
          id="dates-title"
          title={t("timeline.title")}
          lead={t("timeline.lead")}
        />
        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <li
              key={s.kind}
              className={cn(
                "flex gap-4 rounded-3xl border-2 p-5",
                s.past
                  ? "border-border bg-surface-muted"
                  : "border-border-strong bg-surface shadow-warm"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-[22%] font-display text-lead font-bold",
                  s.past
                    ? "bg-surface text-ink-muted"
                    : "bg-pink-700 text-white dark:bg-pink-300 dark:text-neutral-950"
                )}
              >
                {i + 1}
              </span>
              <div>
                <p className="font-semibold text-ink">
                  {t(`timeline.steps.${s.kind}`)}
                </p>
                <p className="mt-1 font-display text-lead text-ink">
                  {s.end
                    ? t("timeline.range", {
                        start: date(s.at),
                        end: date(s.end),
                      })
                    : date(s.at)}
                </p>
                {s.past ? (
                  <p className="mt-1 flex items-center gap-1 text-sm text-ink-muted">
                    <Check aria-hidden="true" className="size-4" />
                    {t("timeline.done")}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="take-part"
        labelledBy="routes-title"
        hue={HUE}
        tone="tint"
        className="scroll-mt-20"
      >
        <SectionHeading id="routes-title" title={t("routes.title")} />
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {school ? (
            <article className="rounded-3xl border-2 border-green-700 bg-surface p-6 shadow-warm dark:border-green-400">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-h4 leading-tight">
                  {t("routes.school.title")}
                </h3>
                <Chip tone="green">{t("routes.recommended")}</Chip>
              </div>
              <p className="mt-3 font-semibold text-ink">
                {t("routes.school.line")}
              </p>
              <p className="mt-2 text-ink-muted">{t("routes.school.body")}</p>
              <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{t("routes.fee")}</span>
                <Fee fee={school.feeBaseMinor} />
              </p>
            </article>
          ) : null}
          {self ? (
            <article className="rounded-3xl border-2 border-border-strong bg-surface p-6 shadow-warm">
              <h3 className="text-h4 leading-tight">
                {t("routes.self.title")}
              </h3>
              <p className="mt-3 font-semibold text-ink">
                {t("routes.self.line")}
              </p>
              <p className="mt-2 text-ink-muted">{t("routes.self.body")}</p>
              <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{t("routes.fee")}</span>
                <Fee fee={self.feeBaseMinor} />
              </p>
            </article>
          ) : null}
        </div>
        <ExplainState
          title={t(`action.${action}.title`)}
          back={{
            href:
              action === "cancelled"
                ? ROUTES.refunds.path
                : ROUTES.contact.path,
            label:
              action === "cancelled"
                ? t("consent.refunds")
                : t("action.contact"),
          }}
          className="mt-8"
        >
          <p>{t(`action.${action}.body`)}</p>
        </ExplainState>
      </Section>

      <Section hue={HUE}>
        <JudgingPath />
        <QuoteFigure id="Q19" hue="green" size="md" className="mt-14" />
      </Section>

      <Section hue={HUE} tone="tint">
        <CertificatePreview />
        <div className="mx-auto mt-12 grid max-w-5xl gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div>
            <h3 id="recognition-title" className="text-h3">
              {t("recognition.title")}
            </h3>
            <ul className="mt-5 grid gap-3">
              {(
                [
                  "participation",
                  "merit",
                  "finalist",
                  "winner",
                  "featured",
                ] as const
              ).map((k, i) => (
                <li key={k} className="flex items-start gap-3">
                  <TileMarker
                    hue={
                      (["green", "blue", "pink", "yellow", "teal"] as const)[i]
                    }
                    className="mt-1"
                  />
                  <span>{t(`recognition.items.${k}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border-2 border-dashed border-border-strong bg-surface p-6">
            <h3 className="text-h4">{t("recognition.prizes")}</h3>
            <p className="mt-3 text-ink-muted">{t("recognition.prizesBody")}</p>
          </div>
        </div>
      </Section>

      <Section labelledBy="files-title" hue={HUE}>
        <SectionHeading id="files-title" title={t("files.title")} />
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fileRules(c.disciplines).map((r) => (
            <li
              key={r.discipline}
              className="rounded-3xl border-2 border-border bg-surface p-5"
            >
              <h3 className="font-sans text-lead font-bold">
                {ts(`discipline.${r.discipline}`)}
              </h3>
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                <dt className="font-semibold">{t("files.types")}</dt>
                <dd className="text-ink-muted">
                  {t(`files.typeNames.${r.types}`)}
                </dd>
                <dt className="font-semibold">{t("files.count")}</dt>
                <dd className="text-ink-muted">
                  {t(`files.countNames.${r.files}`)}
                </dd>
                <dt className="font-semibold">{t("files.max")}</dt>
                <dd className="text-ink-muted">
                  {t("files.maxValue", { mb: r.maxMb })}
                </dd>
                <dt className="font-semibold">{t("files.min")}</dt>
                <dd className="text-ink-muted">
                  {r.minPx === undefined
                    ? t("files.minNone")
                    : r.types === "video"
                      ? t("files.minVideo", { px: r.minPx })
                      : t("files.minValue", { px: format.number(r.minPx) })}
                </dd>
              </dl>
            </li>
          ))}
        </ul>

        <div className="mt-14 grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-h3">{t("rules.title")}</h2>
            <ol className="mt-5 grid gap-3">
              {(["own", "once", "animals", "consent", "theme"] as const).map(
                (k, i) => (
                  <li key={k} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="grid size-8 shrink-0 place-items-center rounded-[22%] bg-section-pink font-display font-bold text-section-pink-heading"
                    >
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{t(`rules.items.${k}`)}</span>
                  </li>
                )
              )}
            </ol>
          </div>
          <div className="grid content-start gap-8">
            <div>
              <h2 className="text-h3">{t("physical.title")}</h2>
              <p className="mt-3">{t("physical.body")}</p>
              <p className="mt-3 text-ink-muted">{t("physical.who")}</p>
            </div>
            <div>
              <h2 className="text-h3">{t("display.title")}</h2>
              <p className="mt-3">{t("display.body")}</p>
              <p className="mt-3 font-semibold">{t("display.noAuction")}</p>
            </div>
          </div>
        </div>
      </Section>

      <Section labelledBy="consent-title" hue={HUE} tone="tint">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <h2 id="consent-title" className="text-h3">
              {t("consent.title")}
            </h2>
            <p className="mt-3 text-ink-muted">{t("consent.body")}</p>
            <ul className="mt-4 grid gap-1">
              {(
                [
                  ["terms", ROUTES.terms.path],
                  ["privacy", ROUTES.privacy.path],
                  ["childProtection", ROUTES.childProtection.path],
                  ["pricing", ROUTES.pricing.path],
                  ["refunds", ROUTES.refunds.path],
                ] as const
              ).map(([k, href]) => (
                <li key={k}>
                  <Link
                    href={href}
                    className={cn(LINK, "inline-flex min-h-11 items-center")}
                  >
                    {t(`consent.${k}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="self-start rounded-3xl bg-surface p-6 shadow-warm">
            <h2 className="text-h3">{t("help.title")}</h2>
            <p className="mt-3 text-ink-muted">{t("help.body")}</p>
            <ButtonLink
              href={ROUTES.contact.path}
              variant="secondary"
              className="mt-5"
            >
              <Mail aria-hidden="true" />
              {t("help.link")}
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
