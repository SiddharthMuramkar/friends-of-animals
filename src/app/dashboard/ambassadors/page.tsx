import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AmbassadorEligibility } from "@/components/community/ambassador-eligibility";
import { AmbassadorOutcome } from "@/components/community/ambassador-outcome";
import { SubmitButton } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { DASHBOARD_COMMUNITY, DASHBOARD_TIMELINE } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { applyAmbassadorAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ambassadors");
  return { title: t("title"), robots: { index: false, follow: false } };
}
type Props = PageProps<"/dashboard/ambassadors">;
export default async function Page({ searchParams }: Props) {
  const t = await getTranslations("ambassadors");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        title={t("title")}
        eyebrow={t("eyebrow")}
        tile="green"
        lead={t("intro")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Application searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}
async function Application({ searchParams }: Pick<Props, "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [data, query, t, format] = await Promise.all([
    as(actor).getMyAmbassador(),
    searchParams,
    getTranslations("ambassadors"),
    getFormatter(),
  ]);
  const date = (value: Date) =>
    format.dateTime(value, { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  return (
    <div className="mt-8 space-y-6 min-w-0">
      <AmbassadorOutcome query={query} />
      <section className="rounded-3xl border-2 border-border bg-surface p-5 sm:p-6">
        <SectionHeading title={t("application")} />
        <p className="mt-3 font-bold text-ink">
          {t(`status.${data.application?.status ?? "none"}`)}
        </p>
        {data.application && (
          <div className="mt-2 space-y-2 text-ink">
            <p>
              {t("submittedAt", { date: date(data.application.submittedAt) })}
            </p>
            {data.application.decidedAt && (
              <p>
                {t("decidedAt", { date: date(data.application.decidedAt) })}
              </p>
            )}
            {data.application.declineReason && (
              <dl>
                <dt className="font-semibold">{t("reason")}</dt>
                <dd className="wrap-anywhere whitespace-pre-wrap">
                  {data.application.declineReason}
                </dd>
              </dl>
            )}
            {data.application.status === "approved" && (
              <p>{t("approvedHint")}</p>
            )}
          </div>
        )}
      </section>
      <section className="rounded-3xl border-2 border-border bg-surface p-5 sm:p-6 space-y-4">
        <SectionHeading id="ambassador-eligibility" title={t("eligibility")} />
        <AmbassadorEligibility value={data.eligibility} />
        {data.eligibility.eligible && (
          <form
            action={applyAmbassadorAction}
            aria-labelledby="ambassador-eligibility"
            className="space-y-3"
          >
            <p className="text-ink-muted">{t("applicationHint")}</p>
            <SubmitButton
              className="min-h-12 max-w-full whitespace-normal"
              pendingLabel={t("working")}
            >
              {t("apply")}
            </SubmitButton>
          </form>
        )}
      </section>
      <div className="flex flex-wrap gap-3">
        <ButtonLink
          href={DASHBOARD_COMMUNITY}
          variant="secondary"
          className="max-w-full whitespace-normal"
        >
          {t("community")}
        </ButtonLink>
        <ButtonLink
          href={DASHBOARD_TIMELINE}
          variant="secondary"
          className="max-w-full whitespace-normal"
        >
          {t("timeline")}
        </ButtonLink>
      </div>
    </div>
  );
}
