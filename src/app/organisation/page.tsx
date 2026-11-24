import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ListingStatusChip } from "@/components/directory/listing-status-chip";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { myListingPath, NGO_REGISTER } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("directory.mine.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const t = await getTranslations("directory.mine");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <MyListings />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function MyListings() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, statuses, types, format, listings] = await Promise.all([
    getTranslations("directory.mine"),
    getTranslations("directory.status"),
    getTranslations("directory.type"),
    getFormatter(),
    as(actor).listMyListings(),
  ]);

  return (
    <div className="mt-8 flex flex-col gap-6">
      {listings.length === 0 ? (
        <p className="text-ink">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {listings.map((listing) => (
            <li key={listing.id} className={CARD}>
              <h2 className="text-lead font-bold text-ink wrap-anywhere">
                <SiteLink
                  href={myListingPath(listing.id)}
                  className="inline-flex min-h-11 items-center text-link underline decoration-2 underline-offset-4 hover:text-link-hover"
                >
                  {listing.name}
                </SiteLink>
              </h2>
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <ListingStatusChip
                  status={listing.status}
                  label={statuses(listing.status)}
                />
                <span className="text-ink-muted">{types(listing.type)}</span>
                <span className="text-ink-muted">
                  {t("changedOn", {
                    date: format.dateTime(listing.statusChangedAt, "long"),
                  })}
                </span>
              </p>
              {listing.statusReason ? (
                <p className="mt-3 text-ink wrap-anywhere">
                  {t("reason", { reason: listing.statusReason })}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div>
        <ButtonLink href={NGO_REGISTER} variant="secondary">
          {t("register")}
        </ButtonLink>
      </div>
    </div>
  );
}
