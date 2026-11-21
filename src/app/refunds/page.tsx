import { CircleCheck, CircleX } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SiteLink } from "@/components/site/site-link";

import { ButtonLink } from "@/components/site/button-link";
import { ContactFact } from "@/components/site/contact-fact";
import { Section } from "@/components/site/section";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { isFactShown, showsPlaceholders, SITE } from "@/lib/site";

import { PolicyBlock, PolicyTop, Tbc } from "../pricing/_components/policy";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("refunds.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.refunds.path,
  });
}

const SHORT = [
  "cancelled",
  "duplicate",
  "confirmed",
  "withdraw",
  "ask",
] as const;
const AUTO = ["cancelled", "duplicate", "twoRoutes", "foreign"] as const;
const NEVER = ["withdraw", "confirmed", "switch"] as const;

export default async function Page() {
  const t = await getTranslations("refunds");
  return (
    <>
      <PolicyTop
        eyebrow={t("eyebrow")}
        title={t("title")}
        updated={t("updated")}
        shortTitle={t("short.title")}
        items={SHORT.map((k) => t(`short.items.${k}`))}
      />
      <Section innerClassName="[&>*]:max-w-3xl">
        <div className="grid gap-12">
          <PolicyBlock id="automatic" title={t("automatic.title")}>
            <ul className="grid gap-3">
              {AUTO.map((k) => (
                <li key={k} className="flex items-start gap-3">
                  <CircleCheck
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-green-700 dark:text-green-300"
                  />
                  <span>{t(`automatic.items.${k}`)}</span>
                </li>
              ))}
            </ul>
          </PolicyBlock>
          <PolicyBlock id="ask-for-one" title={t("discretionary.title")}>
            <p>{t("discretionary.body")}</p>
            <p className="text-ink-muted">{t("discretionary.late")}</p>
          </PolicyBlock>
          <PolicyBlock id="not-refunded" title={t("never.title")}>
            <ul className="grid gap-3">
              {NEVER.map((k) => (
                <li key={k} className="flex items-start gap-3">
                  <CircleX
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-red-700 dark:text-red-300"
                  />
                  <span>{t(`never.items.${k}`)}</span>
                </li>
              ))}
            </ul>
          </PolicyBlock>
          <PolicyBlock id="donations" title={t("donations.title")}>
            <p>{t("donations.body")}</p>
            <p>{t("donations.monthly")}</p>
          </PolicyBlock>
          <PolicyBlock id="timing" title={t("timing.title")}>
            <p>{t("timing.body")}</p>
            {showsPlaceholders() ? (
              <p>
                <Tbc label={t("timing.time")} />
              </p>
            ) : null}
          </PolicyBlock>
          <section
            aria-labelledby="ask"
            className="rounded-3xl border-2 border-border bg-surface p-6 shadow-warm sm:p-8"
          >
            <h2 id="ask" className="text-h3">
              {t("ask.title")}
            </h2>
            <p className="mt-3">{t("ask.body")}</p>
            {isFactShown(SITE.org.email) ? (
              <p className="mt-4 flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t("ask.email")}</span>
                <ContactFact kind="email" fact={SITE.org.email} />
              </p>
            ) : null}
            <ButtonLink href={ROUTES.contact.path} className="mt-6">
              {t("ask.link")}
            </ButtonLink>
          </section>
        </div>
        <p className="mt-10">
          <SiteLink
            href={ROUTES.pricing.path}
            className="inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover"
          >
            {t("pricingLink")}
          </SiteLink>
        </p>
      </Section>
    </>
  );
}
