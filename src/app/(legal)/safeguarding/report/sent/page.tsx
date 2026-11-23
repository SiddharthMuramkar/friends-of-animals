import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ButtonLink } from "@/components/site/button-link";
import { CONTACT_LINK } from "@/components/site/contact-fact";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { contactHref } from "@/lib/contact";
import { ROUTES } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("safeguardingReport.sent.meta");
  return {
    title: t("title"),
    description: t("description"),
    // A confirmation, not a page to find.
    robots: { index: false, follow: false },
  };
}

/**
 * Where a sent report lands (#116). The same for every report: no
 * reference, category or words, so whoever sees this screen afterwards
 * learns only that a report was sent. Prerendered; the Quick exit bar
 * comes from the @exit slot.
 */
export default async function Page() {
  const t = await getTranslations("safeguardingReport.sent");
  return (
    <Section hue="neutral" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("title")}
        lead={t("lead")}
      />
      <section
        aria-labelledby="next-title"
        className="mt-8 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8"
      >
        <SectionHeading id="next-title" title={t("nextTitle")} />
        <p className="mt-3 text-ink">{t("next")}</p>
        <p className="mt-3 text-ink">
          {t.rich("danger", {
            emergency: (chunks) => (
              <a
                href={contactHref("phone", "112")}
                className={`${CONTACT_LINK} font-semibold`}
              >
                {chunks}
              </a>
            ),
          })}
        </p>
        <ButtonLink
          href={ROUTES.safeguarding.path}
          variant="secondary"
          className="mt-6"
        >
          {t("back")}
        </ButtonLink>
      </section>
    </Section>
  );
}
