import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ApplicationStatusChip } from "@/components/adoption/application-parts";
import { AdoptionDisclaimer } from "@/components/adoption/disclaimer";
import { inputStyles } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import {
  ADMIN_ADOPTIONS,
  adminAdoptionApplicationPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { ADOPTION_APPLICATION_STATUSES } from "@/server/modules/adoption/domain/application-status";

import { AdminDenied } from "../_components/admin-denied";
import { adminCall } from "../_lib/boundary";

// The adoption coordinator's queue (#130): open applications by default,
// oldest first; a filter shows one status. Coordinators (global, or for
// their organisations) with their second factor.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adoptionApplications.admin.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = PageProps<"/admin/adoptions">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/admin/adoptions">) {
  const t = await getTranslations("adoptionApplications.admin");
  return (
    <>
      <Section hue="green" tone="tint" width="wide" className="pt-10 sm:pt-14">
        <PageHeader
          eyebrow={t("eyebrow")}
          tile="green"
          title={t("title")}
          lead={t("lead")}
        />
        <Suspense
          fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
        >
          <Queue searchParams={searchParams} />
        </Suspense>
      </Section>
      <Section hue="green" width="wide" className="py-8 sm:py-10">
        <AdoptionDisclaimer />
      </Section>
    </>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const LINK =
  "text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

async function Queue({ searchParams }: { searchParams: SearchParams }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const query = await searchParams;
  const status =
    ADOPTION_APPLICATION_STATUSES.find((value) => value === query.status) ??
    "open";
  const [t, statusWords, facts, format, loaded] = await Promise.all([
    getTranslations("adoptionApplications.admin"),
    getTranslations("adoptionApplications.status"),
    getTranslations("adoptionApplications.facts"),
    getFormatter(),
    adminCall(
      () => as(actor).listAdoptionApplications({ status }),
      `${ADMIN_ADOPTIONS}?status=${status}`
    ),
  ]);
  if (!loaded.ok) return <AdminDenied />;
  const items = Array.isArray(loaded.value) ? loaded.value : [];

  return (
    <>
      <section aria-labelledby="queue-filter" className={`mt-8 ${CARD}`}>
        <SectionHeading id="queue-filter" title={t("filter.title")} />
        <form
          method="get"
          action={ADMIN_ADOPTIONS}
          className="mt-5 flex flex-wrap items-end gap-4"
        >
          <div className="flex min-w-60 flex-col gap-2">
            <label htmlFor="filter-status" className="font-semibold text-ink">
              {t("filter.status")}
            </label>
            <select
              id="filter-status"
              name="status"
              defaultValue={status}
              className={inputStyles}
            >
              <option value="open">{t("filter.open")}</option>
              {ADOPTION_APPLICATION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {statusWords(value)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonStyles()}>
            {t("filter.apply")}
          </button>
        </form>
      </section>

      <section aria-labelledby="queue-list" className="mt-10">
        <SectionHeading id="queue-list" title={t("list.title")} />
        <p className="mt-2 text-ink-muted">
          {t("list.count", { count: items.length })}
        </p>
        {items.length === 0 ? (
          <p className="mt-5 text-ink">{t("list.empty")}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {items.map((item) => (
              <li key={item.id} className={CARD}>
                <ApplicationStatusChip status={item.status} />
                <h3 className="mt-3 text-lead font-bold text-ink wrap-anywhere">
                  <SiteLink
                    href={adminAdoptionApplicationPath(item.id)}
                    className={LINK}
                  >
                    {t("list.applicant", {
                      applicant: item.applicant.name,
                      name: item.animal.name,
                    })}
                  </SiteLink>
                </h3>
                <p className="mt-2 text-ink">
                  {t("list.organisation", {
                    organisation: item.organisation.name,
                  })}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {facts("applied", {
                    date: format.dateTime(item.createdAt, "long"),
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
