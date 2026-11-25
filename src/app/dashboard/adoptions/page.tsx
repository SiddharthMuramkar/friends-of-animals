import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ApplicationStatusChip } from "@/components/adoption/application-parts";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES, myAdoptionApplicationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

// The animals a signed-in user applied to adopt, newest first, and where
// each application stands (#130).

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adoptionApplications.mine.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

const CARD =
  "flex flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

export default async function Page() {
  const t = await getTranslations("adoptionApplications.mine");
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
        <Applications />
      </Suspense>
    </Section>
  );
}

async function Applications() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, facts, format, applications] = await Promise.all([
    getTranslations("adoptionApplications.mine"),
    getTranslations("adoptionApplications.facts"),
    getFormatter(),
    as(actor).myAdoptionApplications(),
  ]);
  return (
    <div className="mt-8 flex flex-col gap-6">
      {applications.length === 0 ? (
        <div className={CARD}>
          <p className="text-ink">{t("empty")}</p>
          <div>
            <ButtonLink href={ROUTES.adopt.path}>{t("browse")}</ButtonLink>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {applications.map((application) => (
            <li key={application.id} className={CARD}>
              <div>
                <ApplicationStatusChip status={application.status} />
              </div>
              <h2 className="text-lead font-bold text-ink wrap-anywhere">
                <SiteLink
                  href={myAdoptionApplicationPath(application.id)}
                  className={inlineLink}
                >
                  {t("open", { name: application.animal.name })}
                </SiteLink>
              </h2>
              <p className="text-sm text-ink-muted">
                {facts("applied", {
                  date: format.dateTime(application.createdAt, "long"),
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p>
        <SiteLink href={APP_ROUTES.dashboard} className={inlineLink}>
          {t("back")}
        </SiteLink>
      </p>
    </div>
  );
}
