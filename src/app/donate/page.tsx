import { Ban, Mail } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Fragment } from "react";

import { KindnessChain } from "@/components/showcase/kindness-chain";
import { StickerScatter } from "@/components/art/sticker-scatter";
import { QuoteFigure } from "@/components/showcase/quote-figure";
import { Callout } from "@/components/site/callout";
import { ContactFact } from "@/components/site/contact-fact";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { JsonLd } from "@/components/site/json-ld";
import { Photo } from "@/components/site/photo";
import { Placeholder } from "@/components/site/placeholder";
import { Section } from "@/components/site/section";
import { type TileHue, TileMarker } from "@/components/site/tile";
import { siteUrl } from "@/env";
import { TRANSPARENCY_PATH } from "@/lib/app-routes";
import { SiteLink } from "@/components/site/site-link";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { WithOrgFacts } from "@/components/site/with-org-facts";
import { isFactShown, SITE } from "@/lib/site";

import { EasyRead } from "@/components/site/easy-read";
import { ButtonLink } from "@/components/site/button-link";

import { DonateSection } from "./_components/donate-section";

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

      {/* The form while online giving is open; "not open yet" otherwise
          (#106). Below the hero, so the heading stays the LCP element. */}
      <Section hue={HUE}>
        <DonateSection />
      </Section>

      <Section
        labelledBy="why-title"
        hue={HUE}
        width="prose"
        className="pt-0 sm:pt-0"
      >
        <SectionHeading id="why-title" title={t("why.title")} />
        <p className="mt-5 text-lead text-ink">{t("why.body")}</p>
        {/* The three steps the paragraph names, drawn (as on /about). */}
        <KindnessChain container="prose" className="mt-10" />
        <p className="mt-10 text-ink-muted">{t("why.notShelter")}</p>
      </Section>

      <Section
        labelledBy="map-title"
        hue={HUE}
        tone="tint"
        innerClassName="relative"
      >
        <SectionHeading
          id="map-title"
          title={t("map.title")}
          lead={t("map.lead")}
        />
        <ul className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
        {/* Five cards leave the grid's last cell empty from sm (two
            columns or three): a sparrow at its water bowl rests in the
            middle of it, centred on the column's middle (a quarter, then a
            sixth, in from the right). */}
        <StickerScatter
          className="hidden sm:block"
          stickers={[
            {
              id: "sticker-sparrow-bowl",
              className:
                "right-1/4 bottom-12 w-20 translate-x-1/2 lg:right-1/6 lg:bottom-18 lg:w-24",
              tilt: -16,
            },
          ]}
        />
      </Section>

      <Section hue={HUE}>
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
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
          <WithOrgFacts>
            {(facts) => {
              // Production leaves out unconfirmed facts with their labels,
              // and the card once none is left.
              const legit = (
                [
                  ["registeredName", facts.legalName],
                  ["registration", facts.registration.type],
                  ["registrationNumber", facts.registration.number],
                  ["pan", facts.registration.pan],
                ] as const
              ).filter(([, fact]) => isFactShown(fact));
              return legit.length > 0 ? (
                <div>
                  <h2 className="text-(--section-heading,var(--ink))">
                    {t("legit.title")}
                  </h2>
                  <p className="mt-4 text-ink-muted">{t("legit.lead")}</p>
                  <dl className="mt-6 grid grid-cols-1 items-center gap-x-5 gap-y-1 rounded-3xl sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-3 border-2 border-border bg-surface p-5 sm:p-6">
                    {legit.map(([label, fact]) => (
                      <Fragment key={label}>
                        <dt className="font-semibold">{t(`legit.${label}`)}</dt>
                        <dd className="mb-2 sm:mb-0">
                          <Placeholder fact={fact} />
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
                  <Callout tone="warning" className="mt-6">
                    <p>{t("legit.honest")}</p>
                  </Callout>
                </div>
              ) : null;
            }}
          </WithOrgFacts>
        </div>
      </Section>

      <Section hue={HUE} tone="tint">
        <div className="mb-8">
          <p className="text-ink-muted">{t("legit.publish")}</p>
          <SiteLink
            href={TRANSPARENCY_PATH}
            className="font-semibold text-link underline"
          >
            {t("legit.transparencyLink")}
          </SiteLink>
        </div>
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
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
            <WithOrgFacts>
              {({ email }) =>
                isFactShown(email) ? (
                  <p className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t("csr.email")}</span>
                    <ContactFact kind="email" fact={email} />
                  </p>
                ) : null
              }
            </WithOrgFacts>
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
