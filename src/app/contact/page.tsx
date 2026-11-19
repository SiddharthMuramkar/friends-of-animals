import { Mail, MapPin, Phone, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { CONTACT_LINK, ContactFact } from "@/components/site/contact-fact";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Photo } from "@/components/site/photo";
import { Placeholder } from "@/components/site/placeholder";
import { Section } from "@/components/site/section";
import { TileMarker } from "@/components/site/tile";
import { contactHref } from "@/lib/contact";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contact.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.contact.path,
  });
}

/** ContactTopic values, in the form's order. */
const TOPICS = [
  "GENERAL",
  "SCHOOLS",
  "NGOS",
  "ADOPTION",
  "VOLUNTEERING",
  "DONATIONS",
  "MEDIA",
] as const;

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/** The safety box's helplines: tel: links, as in the footer. */
const SAFETY_LINE = `${CONTACT_LINK} font-semibold`;
const call = (number: string) => (chunks: ReactNode) => (
  <a href={contactHref("phone", number)} className={SAFETY_LINE}>
    {chunks}
  </a>
);

export default async function Page() {
  const t = await getTranslations("contact");
  const { email, phone, address } = SITE.org;
  const details = [
    { key: "email", icon: Mail, fact: email },
    { key: "phone", icon: Phone, fact: phone },
    { key: "address", icon: MapPin, fact: address },
  ] as const;

  return (
    <>
      <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14">
          <div>
            <PageHeader
              eyebrow={t("hero.eyebrow")}
              tile="blue"
              title={t("hero.title")}
              lead={t("hero.lead")}
            />
            <aside
              aria-labelledby="safety-title"
              className="mt-8 max-w-xl rounded-3xl border-2 border-danger-border bg-danger-bg p-5 sm:p-6"
            >
              <h2
                id="safety-title"
                className="flex items-center gap-2 font-sans text-lead font-bold text-danger"
              >
                <ShieldAlert aria-hidden="true" className="size-6 shrink-0" />
                {t("safety.title")}
              </h2>
              <p className="mt-2 text-ink">
                {t.rich("safety.body", {
                  emergency: call("112"),
                  childline: call("1098"),
                  cyberLine: call("1930"),
                  cyberSite: (chunks) => (
                    <a
                      href="https://cybercrime.gov.in"
                      rel="noreferrer"
                      className={SAFETY_LINE}
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </p>
              <Link href={ROUTES.safeguarding.path} className={LINK}>
                {t("safety.link")}
              </Link>
            </aside>
          </div>
          {/* On phones a half-width print, smaller than the safety note's
              text, so text stays the LCP element (see /donate). */}
          <Photo
            id="dog-thrissur-happy-white"
            sizes="(min-width: 1024px) min(40vw, 512px), (min-width: 640px) min(92vw, 512px), 46vw"
            preload
            frame="blue"
            frameCorner="top-right"
            caption={t("hero.photoCaption")}
            className="aspect-4/3"
            figureClassName="ml-auto mr-2 w-1/2 rotate-2 sm:mx-auto sm:w-full sm:max-w-lg sm:rotate-0"
          />
        </div>
      </Section>

      <Section labelledBy="details-title">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <SectionHeading id="details-title" title={t("details.title")} />
            <dl className="mt-8 grid gap-4">
              {details.map(({ key, icon: Icon, fact }) => (
                <div
                  key={key}
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 rounded-3xl border-2 border-border bg-surface p-4"
                >
                  <dt className="contents">
                    <span
                      aria-hidden="true"
                      className="row-span-2 grid size-11 place-items-center rounded-[22%] bg-section-blue text-section-blue-heading"
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="text-sm font-semibold text-ink-muted">
                      {t(`details.${key}`)}
                    </span>
                  </dt>
                  <dd className="col-start-2 mt-0.5">
                    {key === "address" ? (
                      <Placeholder fact={fact} />
                    ) : (
                      <ContactFact kind={key} fact={fact} />
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 font-display text-lead font-semibold">
              {t("details.reply")}
            </p>
            <p className="mt-2 text-ink-muted">{t("details.form")}</p>
          </div>

          <div>
            <h2 className="text-h3">{t("topics.title")}</h2>
            <p className="mt-3 text-ink-muted">{t("topics.lead")}</p>
            <ul className="mt-6 grid gap-3">
              {TOPICS.map((k) => (
                <li
                  key={k}
                  className="rounded-3xl border-2 border-border bg-surface p-5"
                >
                  <h3 className="flex items-center gap-2 font-sans text-body font-bold">
                    <TileMarker hue="blue" size="sm" />
                    {t(`topics.items.${k}.title`)}
                  </h3>
                  <p className="mt-1.5 text-ink-muted">
                    {t(`topics.items.${k}.body`)}
                  </p>
                </li>
              ))}
              <li className="rounded-3xl border-2 border-danger-border bg-danger-bg p-5">
                <h3 className="flex items-center gap-2 font-sans text-body font-bold">
                  <ShieldAlert
                    aria-hidden="true"
                    className="size-4 text-danger"
                  />
                  {t("topics.safeguarding.title")}
                </h3>
                <p className="mt-1.5 text-ink">
                  {t("topics.safeguarding.body")}
                </p>
                <Link href={ROUTES.safeguarding.path} className={LINK}>
                  {t("topics.safeguarding.link")}
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </Section>

      <Section hue="neutral" tone="tint" labelledBy="before-title">
        <h2 id="before-title" className="text-h3">
          {t("policies.title")}
        </h2>
        <p className="mt-2 text-ink-muted">{t("policies.body")}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {(
            [
              ["pricing", ROUTES.pricing.path],
              ["refunds", ROUTES.refunds.path],
              ["privacy", ROUTES.privacy.path],
            ] as const
          ).map(([k, href]) => (
            <ButtonLink key={k} href={href} variant="secondary">
              {t(`policies.${k}`)}
            </ButtonLink>
          ))}
        </div>
      </Section>
    </>
  );
}
