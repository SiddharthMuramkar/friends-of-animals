import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ADMIN_DONATIONS, APP_ROUTES } from "@/lib/app-routes";

/** The donations pages' frame (#106): a title, and a way back to the list. */
export function DonationsFrame({
  title,
  lead,
  back,
  children,
}: {
  title: string;
  lead?: string;
  back?: string;
  children: ReactNode;
}) {
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      {back ? (
        <SiteLink
          href={ADMIN_DONATIONS}
          className="mb-3 inline-flex min-h-11 items-center text-link underline"
        >
          {back}
        </SiteLink>
      ) : null}
      <PageHeader title={title} lead={lead} />
      <div className="mt-6 space-y-8">{children}</div>
    </Section>
  );
}

/** What anyone but finance sees on the donations pages. */
export async function DonationsDenied() {
  const t = await getTranslations("adminDonations");
  return (
    <DonationsFrame title={t("title")}>
      <ExplainState
        title={t("denied.title")}
        back={{ href: APP_ROUTES.dashboard, label: t("denied.back") }}
      >
        <p>{t("denied.body")}</p>
      </ExplainState>
    </DonationsFrame>
  );
}
