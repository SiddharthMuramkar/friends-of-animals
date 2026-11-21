import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CompetitionDetail } from "@/components/competitions/competition-detail";
import type { CompetitionView } from "@/components/competitions/model";
import { JsonLd } from "@/components/site/json-ld";
import { SiteLink } from "@/components/site/site-link";
import { siteUrl } from "@/env";
import { ROUTES, slugHref } from "@/lib/routes";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

import { publishedCompetition } from "../_lib/public-reads";
import { competitionParams } from "../_lib/view";

// Published competitions live in the database, which the build can't
// reach, so the build prerenders only this route's App Shell (and the
// placeholder). A competition's first visit gets the shell while its page
// renders; later visits get the cached page, which a publish or an edit
// refreshes through the competition's cache tags. src/proxy.ts answers
// unpublished slugs with a 404 before any of this runs.

export function generateStaticParams() {
  return competitionParams();
}

export async function generateMetadata({
  params,
}: PageProps<"/competitions/[slug]">): Promise<Metadata> {
  const c = await publishedCompetition((await params).slug);
  if (!c) return {};
  return pageMetadata({
    title: c.name,
    description: c.theme,
    path: slugHref("competition", c.slug),
  });
}

async function Breadcrumb({ name }: { name: string }) {
  const t = await getTranslations("competitions");
  return (
    <nav aria-label={t("detail.breadcrumb")}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        <li>
          <SiteLink
            href={ROUTES.competitions.path}
            className="inline-flex min-h-6 items-center text-link underline underline-offset-2 hover:text-link-hover"
          >
            {t("meta.title")}
          </SiteLink>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="size-4 text-ink-muted" />
        </li>
        <li aria-current="page" className="text-ink-muted">
          {name}
        </li>
      </ol>
    </nav>
  );
}

async function StructuredData({ c }: { c: CompetitionView }) {
  const t = await getTranslations("competitions.meta");
  const base = siteUrl();
  const path = slugHref("competition", c.slug);
  const at = (kind: CompetitionView["keyDates"][number]["kind"]) =>
    c.keyDates.find((d) => d.kind === kind)?.at;
  return (
    <JsonLd
      data={[
        {
          "@context": "https://schema.org",
          "@type": "Event",
          name: c.name,
          description: c.theme,
          startDate: at("registrationOpens"),
          endDate: at("entriesClose"),
          eventStatus: "https://schema.org/EventScheduled",
          // Entries are uploaded: online only, until a real Place is listed.
          eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
          location: {
            "@type": "VirtualLocation",
            url: new URL(path, base).href,
          },
          organizer: {
            "@type": "NGO",
            name: SITE.name,
            url: new URL("/", base).href,
          },
        },
        breadcrumbJsonLd(base, [
          { name: t("title"), path: ROUTES.competitions.path },
          { name: c.name, path },
        ]),
      ]}
    />
  );
}

/** The page for the requested slug; params resolve inside the boundary. */
async function Competition({ params }: PageProps<"/competitions/[slug]">) {
  const c = await publishedCompetition((await params).slug);
  if (!c) notFound();
  return (
    <>
      <StructuredData c={c} />
      <CompetitionDetail
        competition={c}
        breadcrumb={<Breadcrumb name={c.name} />}
      />
    </>
  );
}

export default function Page(props: PageProps<"/competitions/[slug]">) {
  return (
    <Suspense fallback={<DetailFallback />}>
      <Competition {...props} />
    </Suspense>
  );
}

/** The App Shell's stand-in for the page while it renders. */
async function DetailFallback() {
  const t = await getTranslations("competitions.detail");
  return (
    <output className="mx-auto block max-w-7xl px-4 py-16 sm:px-6">
      <span className="sr-only">{t("loading")}</span>
      <span aria-hidden="true" className="grid max-w-xl gap-4">
        <span className="block h-8 w-32 rounded-full bg-surface-muted" />
        <span className="block h-14 rounded-2xl bg-surface-muted" />
        <span className="block h-24 rounded-2xl bg-surface-muted" />
      </span>
    </output>
  );
}
