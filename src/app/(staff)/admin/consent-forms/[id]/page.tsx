import type { Metadata } from "next";
import { getFormatter, getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { downloadPathFor } from "@/app/account/files/_lib/upload";
import { orSecondFactor } from "@/app/auth/_lib/refusal";
import {
  LegalSectionsText,
  LegalShortList,
} from "@/components/legal/legal-text";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { Disclosure } from "@/components/site/disclosure";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { adminConsentFormPath, APP_ROUTES } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

import { ReviewForm } from "../_components/review-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminConsentForms");
  return { title: t("detailTitle"), robots: { index: false, follow: false } };
}

type Params = PageProps<"/admin/consent-forms/[id]">["params"];

export default async function Page({
  params,
}: PageProps<"/admin/consent-forms/[id]">) {
  const t = await getTranslations("adminConsentForms");
  return (
    <Section hue="neutral" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <ButtonLink
        href={APP_ROUTES.adminConsentForms}
        variant="quiet"
        className="mb-4 -ms-5"
      >
        {t("back")}
      </ButtonLink>
      <PageHeader tile="blue" title={t("detailTitle")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <FormDetails params={params} />
      </Suspense>
    </Section>
  );
}

async function FormDetails({ params }: { params: Params }) {
  const [{ id }, actor, t, format, messages] = await Promise.all([
    params,
    currentActor(),
    getTranslations("adminConsentForms"),
    getFormatter(),
    getMessages(),
  ]);
  const result = await orSecondFactor(async () => {
    try {
      return await as(actor).getConsentFormForReview({ formId: id });
    } catch (error) {
      if (error instanceof DomainError && error.code === "forbidden")
        return null;
      throw error;
    }
  }, adminConsentFormPath(id));
  if (result === null)
    return (
      <ExplainState title={t("deniedTitle")} className="mt-8">
        <p>{t("denied")}</p>
      </ExplainState>
    );
  if (!result.ok) {
    if (result.error === "unavailable")
      return <p className="mt-8">{t("unavailable")}</p>;
    notFound();
  }
  const { form } = result;
  const {
    accept,
    acceptHint,
    reject,
    submitting,
    reason,
    chooseReason,
    reasons,
    note,
    noteHint,
    errors,
  } = messages.adminConsentForms;
  return (
    <article
      aria-labelledby="signed-form-student"
      className="mt-8 grid gap-6 rounded-3xl border-2 border-border bg-surface p-5 text-ink sm:p-6"
    >
      <div>
        <SectionHeading id="signed-form-student" title={form.studentName} />
        <p className="mt-1 wrap-anywhere">
          {form.institutionName} · {form.competitionName}
        </p>
        {form.studentRef ? (
          <p className="mt-1 wrap-anywhere">
            {t("studentRef", { number: form.studentRef })}
          </p>
        ) : form.enrolmentRef ? (
          <p className="mt-1 wrap-anywhere">
            {t("enrolmentRef", { reference: form.enrolmentRef })}
          </p>
        ) : null}
        <p className="mt-3">
          <Chip tone="neutral">{t(`status.${form.status}`)}</Chip>
        </p>
        {form.reviewerName && form.reviewedAt ? (
          <p className="mt-2">
            {t("reviewed", {
              reviewer: form.reviewerName,
              date: format.dateTime(form.reviewedAt, "long"),
            })}
          </p>
        ) : null}
        {form.rejectionReason ? (
          <p className="mt-2">{t(`reasons.${form.rejectionReason}`)}</p>
        ) : null}
        {form.rejectionNote ? (
          <p className="mt-1 wrap-anywhere">{form.rejectionNote}</p>
        ) : null}
      </div>
      <div>
        <p className="mb-2">{t(`scans.${form.scanStatus}`)}</p>
        {form.scanAvailable ? (
          <a
            href={downloadPathFor(form.fileId)}
            rel="noopener noreferrer"
            target="_blank"
            className={buttonStyles({ variant: "secondary" })}
          >
            {t("openScan")}
          </a>
        ) : (
          <p>{t("noScan")}</p>
        )}
      </div>
      <section aria-labelledby="pinned-consent-versions" className="grid gap-3">
        <SectionHeading title={t("pinnedTitle")} id="pinned-consent-versions" />
        {form.documents.map(({ purpose, title, version, body }) => (
          <Disclosure
            key={purpose}
            summary={
              <>
                {t(`purposes.${purpose}`)} · {t("version", { title, version })}
              </>
            }
          >
            <LegalShortList points={body.short} />
            <LegalSectionsText sections={body.sections} level="h3" />
          </Disclosure>
        ))}
      </section>
      {form.status === "pending_review" ? (
        form.ownUpload ? (
          <p>{t("errors.own_upload")}</p>
        ) : (
          <ReviewForm
            formId={form.id}
            canAccept={form.scanAvailable}
            labels={{
              accept,
              acceptHint,
              reject,
              submitting,
              reason,
              chooseReason,
              reasons,
              note,
              noteHint,
              errors,
              problem: messages.common.callout.danger,
            }}
          />
        )
      ) : null}
    </article>
  );
}
