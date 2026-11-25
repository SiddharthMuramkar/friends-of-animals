import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink } from "@/components/site/button-link";
import { SiteLink } from "@/components/site/site-link";
import {
  ADMIN_OBJECTIVES,
  ADMIN_REPORTS,
  ADMIN_SOCIAL_METRICS,
} from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import {
  OBJECTIVE_CATEGORIES,
  objectiveRows,
} from "@/server/modules/reports/objectives";
import { AdminDenied } from "../../_components/admin-denied";
import { adminCall } from "../../_lib/boundary";
import {
  PeriodForm,
  periodFromQuery,
  periodUrl,
} from "../_components/period-form";
import { SocialTable } from "../_components/social-table";

export async function generateMetadata() {
  const t = await getTranslations("objectiveReports");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function Page({
  searchParams,
}: PageProps<"/admin/reports/objectives">) {
  const [t, actor, query] = await Promise.all([
    getTranslations("objectiveReports"),
    currentActor(),
    searchParams,
  ]);
  const period = periodFromQuery(query);
  const loaded = await adminCall(
    () => as(actor).getObjectiveReport(period),
    ADMIN_OBJECTIVES
  );
  const report = loaded.ok && loaded.value.ok ? loaded.value.report : null;
  return (
    <Section width="wide" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("lead")} />
      {!loaded.ok ? (
        <AdminDenied />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-4">
            <SiteLink href={ADMIN_REPORTS}>{t("back")}</SiteLink>
            <SiteLink href={periodUrl(ADMIN_SOCIAL_METRICS, period)}>
              {t("openSocial")}
            </SiteLink>
          </div>
          <PeriodForm path={ADMIN_OBJECTIVES} period={period} />
          {!report ? (
            <p className="mt-4 font-semibold text-danger" role="alert">
              {t("invalidPeriod")}
            </p>
          ) : (
            <>
              <p className="mt-6 font-semibold">{t("range", period)}</p>
              <p className="mt-2 max-w-prose text-ink-muted">
                {t("retention")}
              </p>
              <ButtonLink
                href={periodUrl(`${ADMIN_OBJECTIVES}/export.csv`, period)}
                className="mt-4"
                prefetch={false}
              >
                {t("download")}
              </ButtonLink>
              <p className="mt-2 text-ink-muted">{t("downloadHint")}</p>
              <div className="mt-8 grid gap-4 lg:grid-cols-2">
                {OBJECTIVE_CATEGORIES.map((category) => (
                  <section
                    aria-labelledby={`objective-${category}`}
                    key={category}
                    className="min-w-0 rounded-3xl border-2 border-border bg-surface p-4 sm:p-6"
                  >
                    <h2 id={`objective-${category}`}>
                      {t(`categories.${category}`)}
                    </h2>
                    <p className="mt-3 text-ink-muted">
                      {t(`definitions.${category}`)}
                    </p>
                    <dl className="mt-4 divide-y divide-border">
                      {objectiveRows(report)
                        .filter((row) => row.category === category)
                        .map((row) => (
                          <div
                            key={row.metric}
                            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2"
                          >
                            <dt className="min-w-0 font-semibold">
                              {t(`metrics.${row.metric}`)}
                            </dt>
                            <dd className="min-w-0 font-bold tabular-nums wrap-anywhere">
                              {row.value}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  </section>
                ))}
              </div>
              <SocialTable snapshots={report.social} />
            </>
          )}
        </>
      )}
    </Section>
  );
}
