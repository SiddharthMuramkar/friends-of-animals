import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES, institutionSubmissionsPath } from "@/lib/app-routes";
import type { ConductCertificationView } from "@/server/modules/institution-submissions";

import { actingFor } from "../submissions/_lib/acting-institution";
import { certifyConductAction } from "./_lib/actions";
import { isConductOutcome, type ConductOutcome } from "./_lib/conduct-outcome";

// Render the document on each request so its scripts carry the CSP nonce
// (#65): `instant = false` lets it build with an empty static shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("institutionSubmissions.conduct.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/institution/registrations/[ref]/conduct">;

export default async function Page(props: Props) {
  await connection();
  const t = await getTranslations("institutionSubmissions.conduct");
  return (
    <Section hue="pink" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="pink"
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Conduct {...props} />
      </Suspense>
    </Section>
  );
}

async function Conduct({ params, searchParams }: Props) {
  const [{ ref }, query, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("institutionSubmissions.conduct"),
  ]);
  const { app, institutionId } = await actingFor(query.institution);
  const view = institutionId
    ? await app.getConductCertification({ institutionId, reference: ref })
    : null;
  if (!institutionId || !view?.ok) {
    return (
      <ExplainState
        className="mt-8"
        title={t("notFound.title")}
        back={{ href: APP_ROUTES.dashboard, label: t("back") }}
      >
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }
  return (
    <ConductView
      view={view}
      institutionId={institutionId}
      done={isConductOutcome(query.done) ? query.done : undefined}
      noticeKey={typeof query.n === "string" ? query.n : undefined}
    />
  );
}

async function ConductView({
  view,
  institutionId,
  done,
  noticeKey,
}: {
  view: ConductCertificationView;
  institutionId: string;
  done: ConductOutcome | undefined;
  noticeKey: string | undefined;
}) {
  const [t, callout, format] = await Promise.all([
    getTranslations("institutionSubmissions.conduct"),
    getTranslations("common.callout"),
    getFormatter(),
  ]);
  const { certification } = view;
  const success = done === "certified";
  return (
    <div className="mt-8 flex flex-col gap-8">
      <p className="text-lead font-semibold text-ink wrap-anywhere">
        {t("for", {
          institution: view.institutionName,
          competition: view.competitionName,
        })}
      </p>
      {done ? (
        <OutcomeNotice
          key={noticeKey ?? done}
          tone={success ? "success" : "danger"}
          label={success ? callout("success") : callout("danger")}
          message={t(`outcome.${done}`)}
        />
      ) : null}
      <section
        aria-labelledby="conduct-statement"
        className="rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6"
      >
        <SectionHeading id="conduct-statement" title={t("statementTitle")} />
        <p className="mt-3 text-ink">
          {t("statement", {
            competition: view.competitionName,
            institution: view.institutionName,
          })}
        </p>
        <p className="mt-2 font-mono text-sm text-ink-muted">
          {t("version", {
            version: certification?.statementVersion ?? view.statementVersion,
          })}
        </p>
        {certification ? (
          <p className="mt-4 font-semibold text-ink">
            {certification.certifiedByName
              ? t("certified", {
                  name: certification.certifiedByName,
                  date: format.dateTime(
                    certification.certifiedAt,
                    "longDateTime"
                  ),
                })
              : t("certifiedByFormer", {
                  date: format.dateTime(
                    certification.certifiedAt,
                    "longDateTime"
                  ),
                })}
          </p>
        ) : view.canCertify ? (
          <form action={certifyConductAction} className="mt-5">
            <input type="hidden" name="institutionId" value={institutionId} />
            <input type="hidden" name="reference" value={view.reference} />
            <SubmitButton pendingLabel={t("certifying")}>
              {t("certify")}
            </SubmitButton>
          </form>
        ) : (
          <p className="mt-4 text-ink-muted">{t("cannot")}</p>
        )}
      </section>
      <p>
        <ButtonLink
          href={institutionSubmissionsPath(view.reference, institutionId)}
          variant="quiet"
          className="-ms-5"
        >
          {t("back")}
        </ButtonLink>
      </p>
    </div>
  );
}
