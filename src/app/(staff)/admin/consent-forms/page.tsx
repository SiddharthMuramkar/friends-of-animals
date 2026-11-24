import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { orSecondFactor } from "@/app/auth/_lib/refusal";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES, adminConsentFormPath } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import {
  FORM_STATUSES,
  type FormStatus,
} from "@/server/modules/consent-forms/domain/review";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminConsentForms");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type SearchParams = PageProps<"/admin/consent-forms">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/admin/consent-forms">) {
  const t = await getTranslations("adminConsentForms");
  return (
    <Section hue="neutral" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader tile="blue" title={t("title")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <ReviewQueue searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

function queuePath(status: FormStatus) {
  return status === "pending_review"
    ? APP_ROUTES.adminConsentForms
    : `${APP_ROUTES.adminConsentForms}?status=${status}`;
}

async function ReviewQueue({ searchParams }: { searchParams: SearchParams }) {
  const [actor, query, t, format] = await Promise.all([
    currentActor(),
    searchParams,
    getTranslations("adminConsentForms"),
    getFormatter(),
  ]);
  const status =
    FORM_STATUSES.find((choice) => choice === query.status) ?? "pending_review";
  const result = await orSecondFactor(async () => {
    try {
      return await as(actor).listConsentFormsForReview({ status });
    } catch (error) {
      if (error instanceof DomainError && error.code === "forbidden")
        return null;
      throw error;
    }
  }, queuePath(status));
  if (result === null)
    return (
      <ExplainState title={t("deniedTitle")} className="mt-8">
        <p>{t("denied")}</p>
      </ExplainState>
    );
  if (!result.ok) return <p className="mt-8">{t("unavailable")}</p>;

  return (
    <div className="mt-8 grid gap-5">
      <nav aria-label={t("queueLabel")}>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {FORM_STATUSES.map((choice) => (
            <li key={choice}>
              <SiteLink
                href={queuePath(choice)}
                prefetch={false}
                aria-current={status === choice ? "page" : undefined}
                className="inline-flex min-h-11 items-center text-link underline underline-offset-4 aria-[current=page]:font-bold"
              >
                {t(`status.${choice}`)}
              </SiteLink>
            </li>
          ))}
        </ul>
      </nav>
      {result.forms.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <ol className="grid gap-3">
          {result.forms.map((form) => (
            <li
              key={form.id}
              className="rounded-3xl border-2 border-border bg-surface p-5 text-ink"
            >
              <h2 className="text-h3">
                <SiteLink
                  href={adminConsentFormPath(form.id)}
                  prefetch={false}
                  className="text-link underline underline-offset-4"
                >
                  {t("openForm", { student: form.studentName })}
                </SiteLink>
              </h2>
              <p className="mt-1 wrap-anywhere">
                {form.institutionName} · {form.competitionName}
              </p>
              <p className="mt-1">
                {format.list(
                  form.uses.map((purpose) => t(`purposes.${purpose}`)),
                  "and"
                )}
              </p>
              <p className="mt-1 text-ink-muted">
                {t("submitted", {
                  date: format.dateTime(form.submittedAt, "long"),
                })}{" "}
                · {t(`scans.${form.scanStatus}`)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
