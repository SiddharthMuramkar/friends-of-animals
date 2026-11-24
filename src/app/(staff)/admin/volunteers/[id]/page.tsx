import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { OutcomeNotice } from "@/components/form/outcome-notice";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ApplicationSummary } from "@/components/volunteers/application-summary";
import {
  ADMIN_VOLUNTEERS,
  adminVolunteerApplicationPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DECLINE_REASON_MAX_LENGTH } from "@/server/modules/volunteers/domain/application-input";

import { AdminDenied } from "../../_components/admin-denied";
import { adminCall } from "../../_lib/boundary";
import { ApproveForm, DeclineForm } from "../_components/decision-forms";

// One volunteer application as the community team reviews it (#123): the
// applicant, their age, a teen's guardian's approval, the declarations and
// what they offered; while it waits for them, approve (step-up; grants the
// volunteer role) or decline with a reason.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminVolunteers.detail.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/admin/volunteers/[id]">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminVolunteers");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Application params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "flex flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="font-semibold text-ink sm:w-44 sm:shrink-0">{term}</dt>
      <dd className="min-w-0 text-ink wrap-anywhere">{children}</dd>
    </div>
  );
}

async function Application({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const done =
    query.done === "approved" || query.done === "declined" ? query.done : null;
  const [t, callout, format, loaded] = await Promise.all([
    getTranslations("adminVolunteers"),
    getTranslations("common.callout"),
    getFormatter(),
    adminCall(
      () => as(actor).getVolunteerApplication({ applicationId: id }),
      adminVolunteerApplicationPath(id)
    ),
  ]);
  if (!loaded.ok) {
    return (
      <>
        <PageHeader eyebrow={t("eyebrow")} tile="green" title={t("title")} />
        <AdminDenied />
      </>
    );
  }
  if (!loaded.value.ok) {
    return (
      <>
        <PageHeader eyebrow={t("eyebrow")} tile="green" title={t("title")} />
        <ExplainState
          title={t("detail.notFound")}
          back={{ href: ADMIN_VOLUNTEERS, label: t("detail.back") }}
          className="mt-8"
        >
          <p>{t("detail.notFoundBody")}</p>
        </ExplainState>
      </>
    );
  }
  const { application } = loaded.value;
  const labels = { problem: callout("danger") };
  const standing = (key: "safeguarding" | "conduct") =>
    t(`detail.standing.${application.declarations[key]}`);

  return (
    <>
      <PageHeader
        eyebrow={t("title")}
        tile="green"
        title={application.applicant.name}
        lead={t("detail.lead", { age: application.ageYears })}
      />
      <div className="mt-6">
        <ButtonLink href={ADMIN_VOLUNTEERS} variant="secondary">
          {t("detail.back")}
        </ButtonLink>
      </div>

      <div className="mt-10 flex flex-col gap-8">
        {done ? (
          <OutcomeNotice
            key={typeof query.n === "string" ? query.n : done}
            tone="success"
            label={callout("success")}
            message={t(`detail.done.${done}`, {
              name: application.applicant.name,
            })}
          />
        ) : null}
        <section aria-labelledby="applicant" className={CARD}>
          <SectionHeading id="applicant" title={t("detail.applicant")} />
          <dl className="flex flex-col gap-3">
            <Detail term={t("detail.name")}>
              {application.applicant.name}
            </Detail>
            <Detail term={t("detail.email")}>
              {application.applicant.email ?? t("detail.noEmail")}
            </Detail>
            <Detail term={t("detail.age")}>
              {t("detail.ageValue", { age: application.ageYears })}
            </Detail>
            <Detail term={t("detail.guardian")}>
              {application.guardian
                ? t("detail.guardianApproved", {
                    name: application.guardian.name,
                    date: format.dateTime(
                      application.guardian.decidedAt,
                      "long"
                    ),
                  })
                : application.minor
                  ? t("detail.guardianWaiting")
                  : t("detail.adult")}
            </Detail>
            <Detail term={t("detail.safeguarding")}>
              {standing("safeguarding")}
            </Detail>
            <Detail term={t("detail.conduct")}>{standing("conduct")}</Detail>
            {application.decidedAt ? (
              <Detail term={t("detail.decided")}>
                {t("detail.decidedBy", {
                  name: application.decidedBy?.name ?? t("detail.formerStaff"),
                  date: format.dateTime(application.decidedAt, "long"),
                })}
              </Detail>
            ) : null}
          </dl>
        </section>

        <section aria-labelledby="application" className={CARD}>
          <SectionHeading id="application" title={t("detail.application")} />
          <ApplicationSummary
            application={application}
            audience="staff"
            name={application.applicant.name}
          />
        </section>

        {application.status === "submitted" ? (
          <>
            <section aria-labelledby="approve" className={CARD}>
              <SectionHeading id="approve" title={t("detail.approve.title")} />
              <ApproveForm
                applicationId={application.id}
                labels={{
                  ...labels,
                  body: t("detail.approve.body", {
                    name: application.applicant.name,
                  }),
                  submit: t("detail.approve.submit"),
                  saving: t("detail.approve.saving"),
                }}
              />
            </section>
            <section aria-labelledby="decline" className={CARD}>
              <SectionHeading id="decline" title={t("detail.decline.title")} />
              <DeclineForm
                applicationId={application.id}
                maxLength={DECLINE_REASON_MAX_LENGTH}
                labels={{
                  ...labels,
                  reason: t("detail.decline.reason"),
                  hint: t("detail.decline.hint", {
                    max: DECLINE_REASON_MAX_LENGTH,
                  }),
                  submit: t("detail.decline.submit"),
                  saving: t("detail.decline.saving"),
                }}
              />
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
