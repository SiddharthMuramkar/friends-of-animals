import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { PRIMARY_NAV } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notFound");
  return { title: t("meta.title") };
}

// Baseline 404 (real status for unmatched URLs). The doodle pad (W11) lands
// with the not-found page's own task.
export default async function NotFound() {
  const t = await getTranslations("notFound");
  const tn = await getTranslations("nav");
  return (
    <Section hue="yellow" tone="tint" className="py-16 sm:py-24">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="yellow"
        title={t("title")}
        lead={t("body")}
      />
      <ul className="mt-8 flex flex-wrap gap-2">
        {PRIMARY_NAV.map((route) => (
          <li key={route.id}>
            <Link
              href={route.path}
              className="inline-flex min-h-11 items-center rounded-full border-2 border-border-strong bg-surface px-4 font-semibold hover:border-ink"
            >
              {tn(`links.${route.id}`)}
            </Link>
          </li>
        ))}
      </ul>
      <ButtonLink href="/" className="mt-8">
        {t("home")}
      </ButtonLink>
    </Section>
  );
}
