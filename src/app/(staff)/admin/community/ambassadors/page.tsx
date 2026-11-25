import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AmbassadorEligibility } from "@/components/community/ambassador-eligibility";
import { AmbassadorOutcome } from "@/components/community/ambassador-outcome";
import { inputStyles, SubmitButton, TextAreaField } from "@/components/form";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ADMIN_AMBASSADORS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { AMBASSADOR_STATUSES } from "@/server/modules/community/ambassadors/domain/status";
import { adminCall } from "../../_lib/boundary";
import { AdminDenied } from "../../_components/admin-denied";
import { ambassadorDecisionAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ambassadors.admin");
  return { title: t("title"), robots: { index: false, follow: false } };
}
type Props = PageProps<"/admin/community/ambassadors">;
export default async function Page({ searchParams }: Props) {
  const t = await getTranslations("ambassadors");
  return (
    <Section hue="green" tone="tint" width="wide" className="pt-10 sm:pt-14">
      <PageHeader
        title={t("admin.title")}
        eyebrow={t("eyebrow")}
        tile="green"
        lead={t("admin.intro")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Applications searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}
async function Applications({ searchParams }: Pick<Props, "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [query, t, format] = await Promise.all([
    searchParams,
    getTranslations("ambassadors"),
    getFormatter(),
  ]);
  const status =
    query.status === undefined
      ? "submitted"
      : AMBASSADOR_STATUSES.find((value) => value === query.status);
  const candidate = typeof query.page === "string" ? Number(query.page) : 1;
  const page =
    Number.isSafeInteger(candidate) && candidate >= 1 && candidate <= 100000
      ? candidate
      : 1;
  const href = (n: number) =>
    `${ADMIN_AMBASSADORS}?${new URLSearchParams({ page: String(n), status: status ?? "all" })}`;
  const loaded = await adminCall(
    () => as(actor).listAmbassadorApplications({ status, page }),
    href(page)
  );
  if (!loaded.ok || !loaded.value.ok) return <AdminDenied />;
  const result = loaded.value;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const date = (value: Date) =>
    format.dateTime(value, { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  return (
    <div className="mt-8 space-y-6">
      <AmbassadorOutcome query={query} />
      <search>
        <form
          action={ADMIN_AMBASSADORS}
          method="GET"
          aria-label={t("admin.filter")}
          className="flex flex-wrap items-end gap-4 rounded-3xl border-2 border-border bg-surface p-5"
        >
          <div className="flex min-w-0 flex-col gap-2">
            <label
              htmlFor="ambassador-status"
              className="font-semibold text-ink"
            >
              {t("admin.filter")}
            </label>
            <select
              name="status"
              id="ambassador-status"
              className={inputStyles}
              defaultValue={status ?? "all"}
            >
              <option value="all">{t("status.all")}</option>
              {AMBASSADOR_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonStyles()}>
            {t("admin.show")}
          </button>
        </form>
      </search>
      <section>
        <SectionHeading title={t("admin.count", { count: result.total })} />
        {result.applications.length === 0 ? (
          <p className="mt-4 text-ink-muted">{t("admin.empty")}</p>
        ) : (
          <ul className="mt-4 grid gap-5 md:grid-cols-2">
            {result.applications.map((application) => (
              <li
                key={application.id}
                className="min-w-0 wrap-anywhere rounded-3xl border-2 border-border bg-surface p-5 sm:p-6 space-y-4"
              >
                <h3 className="font-display text-xl font-bold text-ink">
                  {application.applicantName}
                </h3>
                <p className="font-semibold text-ink">
                  {t(`status.${application.status}`)}
                </p>
                <p className="text-ink-muted">
                  {t("submittedAt", { date: date(application.submittedAt) })}
                </p>
                {application.decidedAt && (
                  <p className="text-ink-muted">
                    {t("decidedAt", { date: date(application.decidedAt) })}
                  </p>
                )}
                {application.declineReason && (
                  <dl>
                    <dt className="font-semibold text-ink">{t("reason")}</dt>
                    <dd className="whitespace-pre-wrap text-ink">
                      {application.declineReason}
                    </dd>
                  </dl>
                )}
                {application.eligibility && (
                  <>
                    <AmbassadorEligibility value={application.eligibility} />
                    <h4
                      id={`review-${application.id}`}
                      className="font-semibold text-ink"
                    >
                      {t("admin.review", { name: application.applicantName })}
                    </h4>
                    {application.eligibility.eligible && (
                      <form
                        action={ambassadorDecisionAction.bind(
                          null,
                          application.id,
                          "approve"
                        )}
                        aria-label={t("admin.approve", {
                          name: application.applicantName,
                        })}
                      >
                        <SubmitButton
                          className="min-h-12 max-w-full whitespace-normal"
                          pendingLabel={t("admin.saving")}
                        >
                          {t("admin.approve", {
                            name: application.applicantName,
                          })}
                        </SubmitButton>
                      </form>
                    )}
                    <form
                      action={ambassadorDecisionAction.bind(
                        null,
                        application.id,
                        "decline"
                      )}
                      aria-label={t("admin.decline", {
                        name: application.applicantName,
                      })}
                      className="space-y-3"
                    >
                      <TextAreaField
                        id={`decline-${application.id}`}
                        name="reason"
                        rows={4}
                        required
                        maxLength={1000}
                        label={t("admin.reason")}
                        hint={t("admin.reasonHint")}
                      />
                      <SubmitButton
                        variant="secondary"
                        className="min-h-12 max-w-full whitespace-normal"
                        pendingLabel={t("admin.saving")}
                      >
                        {t("admin.decline", {
                          name: application.applicantName,
                        })}
                      </SubmitButton>
                    </form>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-ink-muted">{t("admin.page", { page, pages })}</p>
      <div className="flex flex-wrap gap-3">
        {page > 1 && (
          <ButtonLink href={href(page - 1)} variant="secondary">
            {t("admin.previous")}
          </ButtonLink>
        )}
        {page < pages && (
          <ButtonLink href={href(page + 1)} variant="secondary">
            {t("admin.next")}
          </ButtonLink>
        )}
      </div>
    </div>
  );
}
