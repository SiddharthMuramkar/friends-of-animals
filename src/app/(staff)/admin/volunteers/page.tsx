import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { inputStyles } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { WorkLinks } from "@/components/volunteers/work-ui";
import { STATUS_TONE } from "@/components/volunteers/application-summary";
import {
  ADMIN_VOLUNTEERS,
  adminVolunteerApplicationPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { VOLUNTEER_APPLICATION_STATUSES } from "@/server/modules/volunteers/domain/application-status";

import { AdminDenied } from "../_components/admin-denied";
import { adminCall } from "../_lib/boundary";

// The community team's queue of volunteer applications (#123): by default
// those waiting for a decision, oldest first; a filter shows the others.
// Community managers and super admins with their second factor.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminVolunteers.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = PageProps<"/admin/volunteers">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/admin/volunteers">) {
  const t = await getTranslations("adminVolunteers");
  return (
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
    VOLUNTEER_APPLICATION_STATUSES.find((value) => value === query.status) ??
    "submitted";
  const [t, summary, interests, format, loaded] = await Promise.all([
    getTranslations("adminVolunteers"),
    getTranslations("volunteer.summary"),
    getTranslations("volunteer.interests"),
    getFormatter(),
    adminCall(
      () => as(actor).listVolunteerApplications({ status }),
      `${ADMIN_VOLUNTEERS}?status=${status}`
    ),
  ]);
  if (!loaded.ok) return <AdminDenied />;
  const result = loaded.value;
  const items = result.ok ? result.items : [];

  return (
    <>
      <div className="mt-6">
        <WorkLinks staff />
      </div>
      <section aria-labelledby="queue-filter" className={`mt-8 ${CARD}`}>
        <SectionHeading id="queue-filter" title={t("filter.title")} />
        <form
          method="get"
          action={ADMIN_VOLUNTEERS}
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
              {VOLUNTEER_APPLICATION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {summary(`status.${value}`)}
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
        <SectionHeading
          id="queue-list"
          title={t("list.title", { status: summary(`status.${status}`) })}
        />
        <p className="mt-2 text-ink-muted">
          {t("list.count", { count: items.length })}
        </p>
        {items.length === 0 ? (
          <p className="mt-5 text-ink">{t("list.empty")}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {items.map((item) => (
              <li key={item.id} className={CARD}>
                <div className="flex flex-wrap items-center gap-3">
                  <Chip tone={STATUS_TONE[item.status]}>
                    {summary(`status.${item.status}`)}
                  </Chip>
                </div>
                <h3 className="mt-3 text-lead font-bold text-ink wrap-anywhere">
                  <SiteLink
                    href={adminVolunteerApplicationPath(item.id)}
                    className={LINK}
                  >
                    {item.applicant.name}
                  </SiteLink>
                </h3>
                <p className="mt-2 text-ink">
                  {t("list.age", { age: item.ageYears })} ·{" "}
                  {format.list(
                    item.interests.map((interest) => interests(interest)),
                    "and"
                  )}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {t("list.applied", {
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
