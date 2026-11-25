import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { OutcomeNotice } from "@/components/form/outcome-notice";
import {
  LegalSectionsText,
  LegalShortList,
} from "@/components/legal/legal-text";
import { Disclosure } from "@/components/site/disclosure";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { env } from "@/env";
import { guardianChildConsentsPath, guardianChildPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { documentVersionPath } from "@/server/modules/competitions/domain/consent-attachments";
import {
  guardianDocumentPurpose,
  PUBLIC_USES,
} from "@/server/modules/consent/domain/guardian-purposes";
import { guardianFlowsActive } from "@/server/modules/guardians/availability";

import { PurposeCard } from "./_components/purpose-card";

type Props = PageProps<"/guardian/children/[id]/consents">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("childConsents");
  return { title: t("meta"), robots: { index: false, follow: false } };
}

export default async function Page(props: Props) {
  const t = await getTranslations("childConsents");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Consents {...props} />
      </Suspense>
    </Section>
  );
}

const OUTCOMES = [
  "given",
  "withdrawn",
  "document_outdated",
  "unavailable",
  "failed",
] as const;

async function Consents({ params, searchParams }: Props) {
  const [{ id }, query, actor, t, callout] = await Promise.all([
    params,
    searchParams,
    currentActor(),
    getTranslations("childConsents"),
    getTranslations("common.callout"),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const view = await as(actor)
    .childConsents({ childId: id })
    .catch((error: unknown) => {
      if (error instanceof DomainError && error.code === "forbidden")
        notFound();
      throw error;
    });
  if (!view.ok) notFound();
  const { child, competitions, communications } = view;
  const outcome = OUTCOMES.find((kind) => kind === query.done);
  const success = outcome === "given" || outcome === "withdrawn";
  const globalDocument = communications.document;
  const canGive = guardianFlowsActive(env().APP_ENV);

  return (
    <>
      <PageHeader
        tile="green"
        title={t("title", { name: child.fullName })}
        lead={t(canGive ? "lead" : "reviewLead")}
      />
      <div className="mt-8 flex flex-col gap-8">
        {outcome ? (
          <OutcomeNotice
            key={typeof query.n === "string" ? query.n : outcome}
            tone={success ? "success" : "danger"}
            label={callout(success ? "success" : "danger")}
            message={t(`notice.${outcome}`)}
          />
        ) : null}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <SiteLink href={guardianChildPath(child.id)} className={inlineLink}>
            {t("back")}
          </SiteLink>
          <SiteLink
            href={`${guardianChildConsentsPath(child.id)}/history`}
            className={inlineLink}
          >
            {t("historyLink")}
          </SiteLink>
        </div>
        {competitions.length === 0 ? (
          <p className="text-ink-muted">{t("empty")}</p>
        ) : null}
        {competitions.map(({ id, title, purposes, creditPreview }) => {
          const heading = `competition-${id}`;
          const creditHeading = `${heading}-credit`;
          return (
            <section
              key={id}
              aria-labelledby={heading}
              className="flex flex-col gap-4"
            >
              <SectionHeading id={heading} title={title} />
              <section
                aria-labelledby={`${heading} ${creditHeading}`}
                className="rounded-3xl border-2 border-border bg-surface p-5 sm:p-6"
              >
                <h3 id={creditHeading} className="text-lead font-bold text-ink">
                  {t("credit.title")}
                </h3>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  {PUBLIC_USES.map((use) => {
                    const credit = creditPreview[use];
                    return (
                      <div key={use}>
                        <dt className="font-semibold text-ink">
                          {t(`credit.${use}`)}
                        </dt>
                        <dd className="wrap-anywhere text-ink-muted">
                          {credit
                            ? [credit.name, credit.school, credit.city]
                                .filter(Boolean)
                                .join(" · ")
                            : t("credit.hidden")}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
              {purposes.map((consent) => {
                const purpose = guardianDocumentPurpose(consent.purpose);
                const document = consent.document;
                return (
                  <PurposeCard
                    key={consent.purpose}
                    childId={child.id}
                    competitionId={id}
                    groupHeading={heading}
                    consent={consent}
                    canGive={canGive}
                    documentText={
                      document && purpose !== "communications" ? (
                        <p>
                          <SiteLink
                            href={documentVersionPath(
                              purpose,
                              document.version
                            )}
                            className={inlineLink}
                          >
                            {t("document", document)}
                          </SiteLink>
                        </p>
                      ) : null
                    }
                  />
                );
              })}
            </section>
          );
        })}
        <PurposeCard
          childId={child.id}
          consent={{ ...communications, purpose: "communications" }}
          canGive={canGive}
          documentText={
            globalDocument ? (
              <>
                <LegalShortList
                  points={globalDocument.body.short}
                  className="list-disc space-y-2 ps-5 text-ink"
                />
                <Disclosure
                  summary={t("document", {
                    title: globalDocument.title,
                    version: globalDocument.version,
                  })}
                >
                  <LegalSectionsText
                    sections={globalDocument.body.sections}
                    level="h3"
                  />
                </Disclosure>
              </>
            ) : null
          }
        />
      </div>
    </>
  );
}
