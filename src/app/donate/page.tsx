import { Ban, Mail } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { QuoteFigure } from "@/components/showcase/quote-figure";
import { Callout } from "@/components/site/callout";
import { ContactFact } from "@/components/site/contact-fact";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { JsonLd } from "@/components/site/json-ld";
import { Photo } from "@/components/site/photo";
import { Placeholder } from "@/components/site/placeholder";
import { Section } from "@/components/site/section";
import { type TileHue, TileMarker } from "@/components/site/tile";
import { siteUrl } from "@/env";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";
import { getOrgFacts } from "@/server/modules/cms/org-facts";

import { EasyRead } from "@/components/site/easy-read";
import { ButtonLink } from "@/components/site/button-link";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("donate.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.donate.path,
  });
}

const HUE = ROUTES.donate.hue;

const MAP = [
  { key: "competitions", hue: "pink" },
  { key: "schools", hue: "green" },
  { key: "awareness", hue: "teal" },
  { key: "safety", hue: "blue" },
  { key: "running", hue: "yellow" },
] as const satisfies readonly { key: string; hue: TileHue }[];

const CANT = ["tax", "foreign", "minors", "rescue"] as const;

export default async function Page() {
  const t = await getTranslations("donate");
  const tc = await getTranslations("competitions");
  const facts = await getOrgFacts();
  const { registration } = facts;
  const base = siteUrl();

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "DonateAction",
          name: t("meta.title"),
          description: t("meta.description"),
          recipient: {
            "@type": "NGO",
            name: SITE.name,
            url: new URL("/", base).href,
          },
        }}
      />

      <Section hue={HUE} tone="tint" className="pt-10 sm:pt-14">
        {/* Text, quote, then photo: on phones the photo sits below the first
            screen, so the heading text stays the LCP element (a hero image
            there would make Lighthouse count every script before it). From
            lg the photo takes the right column and the quote spans below. */}
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14">
          <div>
            <PageHeader
              eyebrow={t("hero.eyebrow")}
              tile="red"
              title={t("hero.title")}
              lead={t("hero.lead")}
            />
            <EasyRead
              label={tc("easyRead")}
              tile="red"
              className="mt-8 max-w-xl"
            >
              <p>{t("hero.easy")}</p>
            </EasyRead>
          </div>
          <QuoteFigure
            id="Q24"
            hue="red"
            size="md"
            className="mt-4 sm:mt-10 lg:col-span-2 lg:mt-6"
          />
          <Photo
            id="dog-anjuna-beach-happy"
            sizes="(min-width: 1024px) min(40vw, 512px), min(92vw, 512px)"
            preload
            frame="red"
            frameCorner="top-left"
            caption={t("hero.photoCaption")}
            className="aspect-4/3"
            figureClassName="mx-auto w-full max-w-lg lg:col-start-2 lg:row-start-1"
          />
        </div>
      </Section>

      <Section hue={HUE}>
        <ExplainState
          title={t("notLive.title")}
          back={{ href: ROUTES.contact.path, label: t("notLive.back") }}
          className="mx-auto max-w-3xl"
        >
          <p>{t("notLive.body")}</p>
          <p>{t("notLive.rules")}</p>
        </ExplainState>
      </Section>

      <Section
        labelledBy="why-title"
        hue={HUE}
        width="prose"
        className="pt-0 sm:pt-0"
      >
        <SectionHeading id="why-title" title={t("why.title")} />
        <p className="mt-5 text-lead text-ink">{t("why.body")}</p>
        <p className="mt-4 text-ink-muted">{t("why.notShelter")}</p>
      </Section>

      <Section labelledBy="map-title" hue={HUE} tone="tint">
        <SectionHeading
          id="map-title"
          title={t("map.title")}
          lead={t("map.lead")}
        />
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MAP.map(({ key, hue }) => (
            <li key={key} className="rounded-3xl bg-surface p-6 shadow-warm">
              <TileMarker hue={hue} size="lg" />
              <h3 className="mt-4 text-h4 leading-tight">
                {t(`map.items.${key}.title`)}
              </h3>
              <p className="mt-2 text-ink-muted">
                {t(`map.items.${key}.body`)}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section hue={HUE}>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <h2 className="text-(--section-heading,var(--ink))">
              {t("cant.title")}
            </h2>
            <ul className="mt-6 grid gap-4">
              {CANT.map((k) => (
                <li key={k} className="flex items-start gap-3">
                  <Ban
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-red-700 dark:text-red-300"
                  />
                  <span>{t(`cant.items.${k}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-(--section-heading,var(--ink))">
              {t("legit.title")}
            </h2>
            <p className="mt-4 text-ink-muted">{t("legit.lead")}</p>
            <dl className="mt-6 grid items-center gap-x-5 gap-y-1 rounded-3xl sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-3 border-2 border-border bg-surface p-5 sm:p-6">
              <dt className="font-semibold">{t("legit.registeredName")}</dt>
              <dd className="mb-2 sm:mb-0">
                <Placeholder fact={facts.legalName} />
              </dd>
              <dt className="font-semibold">{t("legit.registration")}</dt>
              <dd className="mb-2 sm:mb-0">
                <Placeholder fact={registration.type} />
              </dd>
              <dt className="font-semibold">{t("legit.registrationNumber")}</dt>
              <dd className="mb-2 sm:mb-0">
                <Placeholder fact={registration.number} />
              </dd>
              <dt className="font-semibold">{t("legit.pan")}</dt>
              <dd className="mb-2 sm:mb-0">
                <Placeholder fact={registration.pan} />
              </dd>
            </dl>
            <Callout tone="warning" className="mt-6">
              <p>{t("legit.honest")}</p>
            </Callout>
            <p className="mt-4 text-ink-muted">{t("legit.publish")}</p>
          </div>
        </div>
      </Section>

      <Section hue={HUE} tone="tint">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-h3 text-(--section-heading,var(--ink))">
              {t("receipts.title")}
            </h2>
            <p className="mt-3">{t("receipts.body")}</p>
          </div>
          <div className="rounded-3xl bg-surface p-6 shadow-warm">
            <h2 className="text-h3 text-(--section-heading,var(--ink))">
              {t("csr.title")}
            </h2>
            <p className="mt-3 text-ink-muted">{t("csr.body")}</p>
            <p className="mt-4 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{t("csr.email")}</span>
              <ContactFact kind="email" fact={facts.email} />
            </p>
            <ButtonLink
              href={ROUTES.contact.path}
              variant="secondary"
              className="mt-5"
            >
              <Mail aria-hidden="true" />
              {t("csr.link")}
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
