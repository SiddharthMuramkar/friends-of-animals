import { Check, Mail, Minus } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { CertificatePreview } from "@/components/showcase/certificate-preview";
import { cachedNow } from "@/components/showcase/clock";
import { JudgingPath } from "@/components/showcase/judging-path";
import { QuoteFigure } from "@/components/showcase/quote-figure";
import { StatusChip } from "@/components/showcase/status-chip";
import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { Eyebrow, SectionHeading } from "@/components/site/heading";
import { Photo } from "@/components/site/photo";
import { Placeholder } from "@/components/site/placeholder";
import { SampleTag } from "@/components/site/sample-tag";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { TileMarker } from "@/components/site/tile";
import { feeDisplay } from "@/content/sample/selectors";
import { ROUTES } from "@/lib/routes";
import { placeholder } from "@/lib/site";
import { cn } from "@/lib/utils";

import { CompetitionTerms } from "./competition-terms";
import { feeText } from "./fee-text";
import {
  ageRange,
  type CompetitionTermsView,
  type CompetitionView,
  type Discipline,
  fileRules,
  nextKeyDate,
  paragraphs,
  primaryAction,
  timeline,
} from "./model";

const HUE = ROUTES.competition.hue;
const LINK =
  "font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/**
 * A route's fee: the competition's own (#72) when its terms are read, else
 * the card's (a sample's amount, or a placeholder).
 */
async function Fee({
  fee,
  line,
}: {
  fee: CompetitionView["routes"][number]["fee"];
  line: CompetitionTermsView["fees"][number] | undefined;
}) {
  const t = await getTranslations("competitions.detail");
  if (line) {
    const [tFees, format] = await Promise.all([
      getTranslations("competitionTerms.fees"),
      getFormatter(),
    ]);
    return (
      <span className="font-display font-semibold text-ink">
        {feeText(line, { t: tFees, format })}
      </span>
    );
  }
  const shown = feeDisplay(fee);
  if (shown.kind === "placeholder")
    return <Placeholder fact={placeholder(shown.key)} />;
  return (
    <span className="font-display font-semibold text-ink">
      {shown.kind === "free" ? t("free") : shown.text}
    </span>
  );
}

function Paragraphs({ text, className }: { text: string; className?: string }) {
  return paragraphs(text).map((p, i) => (
    <p key={i} className={cn(i > 0 && "mt-3", className)}>
      {p}
    </p>
  ));
}

/**
 * A competition's page below its breadcrumb: what it is about, who can
 * enter with what, the dates in IST, the ways in, and its rules and scope.
 * The public page (/competitions/[slug]) and the admin preview render the
 * same body, so a preview shows exactly what will go live.
 */
export async function CompetitionDetail({
  competition: c,
  breadcrumb,
  titleAs: Title = "h1",
}: {
  competition: CompetitionView;
  /** Shown above the heading, e.g. the public page's breadcrumb. */
  breadcrumb?: ReactNode;
  /**
   * The competition's name heads the public page; under another page's
   * heading (the admin preview's) it's an h2, so the page keeps one h1.
   */
  titleAs?: "h1" | "h2";
}) {
  const t = await getTranslations("competitions.detail");
  const tTerms = await getTranslations("competitionTerms");
  const ts = await getTranslations("sample");
  const format = await getFormatter();
  const now = new Date(await cachedNow());
  const date = (iso: string) => format.dateTime(new Date(iso), "long");
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), "longDateTime");
  const discipline = (d: Discipline) => ts(`discipline.${d}`);

  const ages = c.ageGroups.length > 0 ? ageRange(c.ageGroups) : null;
  const next = nextKeyDate(c.keyDates, now);
  const steps = timeline(c.keyDates, now);
  const action = primaryAction(c.status);
  const opens = c.keyDates.find((d) => d.kind === "registrationOpens");
  const actionLabel =
    action !== "opensSoon"
      ? t(`action.${action}.label`)
      : opens
        ? t("action.opensSoon.label", { date: date(opens.at) })
        : t("action.opensSoon.title");
  const route = (r: "INSTITUTION" | "INDIVIDUAL") =>
    c.routes.find((x) => x.route === r);
  const school = route("INSTITUTION");
  const self = route("INDIVIDUAL");
  const termsFee = (r: "institution" | "individual") =>
    c.terms?.fees.find((line) => line.route === r);
  const isOpen = (d: Discipline, group: string) =>
    c.categories.some((x) => x.discipline === d && x.ageGroup === group);
  const artwork = c.physicalArtwork;

  return (
    <>
      <Section hue={HUE} tone="tint" className="pt-8 sm:pt-10">
        {breadcrumb}
        <div
          className={cn(
            "grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14",
            breadcrumb !== undefined && "mt-8"
          )}
        >
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={c.status} />
              {c.sample ? <SampleTag /> : null}
            </div>
            <Title className="mt-4 text-(--section-heading,var(--ink))">
              {c.name}
            </Title>
            {c.theme ? (
              <p className="mt-5 max-w-prose text-lead text-ink">{c.theme}</p>
            ) : null}

            <ButtonLink href="#take-part" size="lg" className="mt-8">
              {actionLabel}
            </ButtonLink>

            <dl
              aria-label={t("facts")}
              className="mt-8 grid max-w-xl grid-cols-1 gap-x-6 gap-y-1 rounded-3xl bg-surface p-5 shadow-warm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-3 sm:p-6 max-sm:[&>dt:not(:first-of-type)]:mt-3"
            >
              {ages ? (
                <>
                  <dt className="font-semibold text-ink">{t("ages")}</dt>
                  <dd className="text-ink-muted">{t("ageRange", ages)}</dd>
                </>
              ) : null}
              {c.disciplines.length > 0 ? (
                <>
                  <dt className="font-semibold text-ink">{t("disciplines")}</dt>
                  <dd className="text-ink-muted">
                    {format.list(c.disciplines.map(discipline), "and")}
                  </dd>
                </>
              ) : null}
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
            sizes="(min-width: 1024px) min(40vw, 512px), min(92vw, 512px)"
            preload
            frame="blue"
            frameCorner="top-right"
            className="aspect-4/3"
            figureClassName="mx-auto w-full max-w-lg"
          />
        </div>
      </Section>

      {c.welfareMessage ? (
        <Section labelledBy="theme-title" hue={HUE}>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
            <div>
              <Eyebrow tile="pink">{t("theme.eyebrow")}</Eyebrow>
              <h2
                id="theme-title"
                className="mt-2 text-(--section-heading,var(--ink))"
              >
                {t("theme.welfare")}
              </h2>
            </div>
            <div className="max-w-prose text-lead text-ink">
              <Paragraphs text={c.welfareMessage} />
            </div>
          </div>
        </Section>
      ) : null}

      {c.disciplines.length > 0 && c.ageGroups.length > 0 ? (
        <Section labelledBy="categories-title" hue={HUE} tone="tint">
          <SectionHeading
            id="categories-title"
            title={t("categories.title")}
            lead={
              c.ageCutoffDate
                ? t("categories.lead", {
                    date: date(`${c.ageCutoffDate}T00:00:00+05:30`),
                  })
                : undefined
            }
          />
          <TableScroller captionId="categories-caption" className="mt-8">
            <table className="w-full text-left">
              <caption id="categories-caption" className="sr-only">
                {t("categories.caption")}
              </caption>
              <thead className="bg-surface-muted text-sm">
                <tr>
                  <th
                    scope="col"
                    className="sticky start-0 bg-surface-muted px-5 py-3 font-semibold"
                  >
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
                    <th
                      scope="row"
                      className="sticky start-0 bg-surface px-5 py-3 font-semibold"
                    >
                      {discipline(d)}
                    </th>
                    {c.ageGroups.map((g) => (
                      <td key={g.label} className="px-5 py-3">
                        {isOpen(d, g.label) ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Check
                              aria-hidden="true"
                              className="size-5 shrink-0 text-green-700 dark:text-green-300"
                            />
                            {t("categories.open")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-ink-muted">
                            <Minus
                              aria-hidden="true"
                              className="size-5 shrink-0"
                            />
                            {t("categories.closed")}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </Section>
      ) : null}

      {steps.length > 0 ? (
        <Section labelledBy="dates-title" hue={HUE}>
          <SectionHeading
            id="dates-title"
            title={t("timeline.title")}
            lead={t("timeline.lead")}
          />
          <ol className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {t(`timeline.steps.${s.kind}`)}
                  </p>
                  <p className="mt-1 font-display text-lead text-ink">
                    <time dateTime={s.at}>{dateTime(s.at)}</time>
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
      ) : null}

      <Section
        id="take-part"
        labelledBy="routes-title"
        hue={HUE}
        tone="tint"
        className="scroll-mt-20"
      >
        <SectionHeading
          id="routes-title"
          title={c.routes.length > 1 ? t("routes.title") : t("routes.titleOne")}
        />
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
          {school ? (
            <article className="rounded-3xl border-2 border-green-700 bg-surface p-6 shadow-warm dark:border-green-400">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-h4 leading-tight">
                  {t("routes.school.title")}
                </h3>
                {self ? (
                  <Chip tone="green">{t("routes.recommended")}</Chip>
                ) : null}
              </div>
              <p className="mt-3 font-semibold text-ink">
                {t("routes.school.line")}
              </p>
              <p className="mt-2 text-ink-muted">{t("routes.school.body")}</p>
              <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{t("routes.fee")}</span>
                <Fee fee={school.fee} line={termsFee("institution")} />
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
                <Fee fee={self.fee} line={termsFee("individual")} />
              </p>
              {/* Through the chooser, which recommends the school route
                  first (#78). */}
              {c.status === "REGISTRATION_OPEN" && !c.sample ? (
                <ButtonLink
                  href={`${ROUTES.participate.path}?${new URLSearchParams({ competition: c.slug }).toString()}`}
                  variant="secondary"
                  className="mt-5"
                >
                  {t("routes.self.register")}
                </ButtonLink>
              ) : null}
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
        {c.terms ? (
          <CompetitionTerms
            terms={c.terms}
            headingLevel="h3"
            className="mt-8"
          />
        ) : null}
      </Section>

      <Section hue={HUE}>
        <JudgingPath />
        <QuoteFigure id="Q19" hue="green" size="md" className="mt-14" />
      </Section>

      <Section hue={HUE} tone="tint">
        <CertificatePreview />
        <div className="mx-auto mt-12 grid grid-cols-1 max-w-5xl gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
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
            <p className="mt-3 text-ink-muted">
              {c.terms ? tTerms("prizesAbove") : t("recognition.prizesBody")}
            </p>
          </div>
        </div>
      </Section>

      {c.disciplines.length > 0 ? (
        <Section labelledBy="files-title" hue={HUE}>
          <SectionHeading id="files-title" title={t("files.title")} />
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fileRules(c.disciplines).map((r) => (
              <li
                key={r.discipline}
                className="rounded-3xl border-2 border-border bg-surface p-5"
              >
                <h3 className="font-sans text-lead font-bold">
                  {discipline(r.discipline)}
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
                  {r.minPx === undefined ? null : (
                    <>
                      <dt className="font-semibold">{t("files.min")}</dt>
                      <dd className="text-ink-muted">
                        {r.types === "video"
                          ? t("files.minVideo", { px: r.minPx })
                          : t("files.minValue", {
                              px: format.number(r.minPx),
                            })}
                      </dd>
                    </>
                  )}
                  {r.maxWords === undefined ? null : (
                    <>
                      <dt className="font-semibold">{t("files.length")}</dt>
                      <dd className="text-ink-muted">
                        {t("files.lengthValue", {
                          words: format.number(r.maxWords),
                        })}
                      </dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section labelledBy="rules-title" hue={HUE}>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div>
            <h2 id="rules-title" className="text-h3">
              {t("rules.title")}
            </h2>
            {c.rules ? (
              <div className="mt-4 max-w-prose">
                <Paragraphs text={c.rules} />
              </div>
            ) : null}
            {c.permittedMaterials || c.duration ? (
              <dl className="mt-5 grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_minmax(0,1fr)]">
                {c.permittedMaterials ? (
                  <>
                    <dt className="font-semibold">{t("rules.materials")}</dt>
                    <dd className="text-ink-muted">
                      <Paragraphs text={c.permittedMaterials} />
                    </dd>
                  </>
                ) : null}
                {c.duration ? (
                  <>
                    <dt className="font-semibold">{t("rules.duration")}</dt>
                    <dd className="text-ink-muted">{c.duration}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
            <h3 className="mt-8 text-h4">{t("rules.always")}</h3>
            <ol className="mt-4 grid gap-3">
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
              <h2 className="text-h3">{t("entries.title")}</h2>
              <p className="mt-3">
                {school && c.digitalScope === "shortlist_only"
                  ? t("entries.shortlist")
                  : t("entries.all")}
              </p>
              {school ? (
                <p className="mt-3 text-ink-muted">
                  {t("entries.schools", {
                    count: c.shortlistPerCategory,
                    positions: c.schoolPositions,
                  })}
                </p>
              ) : null}
            </div>
            <div>
              <h2 className="text-h3">{t("physical.title")}</h2>
              <p className="mt-3">
                {artwork.kind === "top_n"
                  ? t("physical.topN", { count: artwork.count })
                  : artwork.kind === "all_shortlisted"
                    ? t("physical.allShortlisted")
                    : t("physical.notRequired")}
              </p>
              {artwork.kind === "not_required" ? null : (
                <p className="mt-3 text-ink-muted">{t("physical.who")}</p>
              )}
            </div>
            <div>
              <h2 className="text-h3">{t("display.title")}</h2>
              <p className="mt-3">
                {c.publicDisplay ? t("display.body") : t("display.notShown")}
              </p>
              <p className="mt-3 font-semibold">
                {c.auctionPermitted
                  ? t("display.auction")
                  : t("display.noAuction")}
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section labelledBy="consent-title" hue={HUE} tone="tint">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
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
                  <SiteLink
                    href={href}
                    className={cn(LINK, "inline-flex min-h-11 items-center")}
                  >
                    {t(`consent.${k}`)}
                  </SiteLink>
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
