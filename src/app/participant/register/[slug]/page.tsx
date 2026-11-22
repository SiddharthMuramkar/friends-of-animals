import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Callout } from "@/components/site/callout";
import { PageHeader } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ROUTES, slugHref } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { countryOptions } from "@/server/modules/participants/register-input";

import { TEXT_FIELDS, type FormField } from "./_lib/form-state";
import { refusalBeforeForm, refusalView, type Refusal } from "./_lib/refusal";
import {
  RegisterForm,
  type RegisterFormLabels,
} from "./_components/register-form";

// The individual register form (#78), for a signed-in adult. It takes a
// date of birth, phone and address, so it sits in the signed-in tree:
// src/proxy.ts sends visitors to sign in, answers an unknown or draft
// competition with the 404, and gives the page the nonce policy. The
// participant layout waits for the request, so it renders at request time.

const HUE = ROUTES.participate.hue;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("participant.register.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = PageProps<"/participant/register/[slug]">;

export default function Page({ params }: Props) {
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<Loading />}>
        <Register params={params} />
      </Suspense>
    </Section>
  );
}

async function Loading() {
  const t = await getTranslations("participant.register");
  return <p className="text-ink-muted">{t("loading")}</p>;
}

const REFUSALS: readonly Refusal[] = [
  "registration_closed",
  "institutions_only",
  "fee_not_set",
  "dob_invalid",
  "minor",
  "outside_age_groups",
  "already_registered",
  "consent_missing",
  "not_found",
];

async function Register({ params }: { params: Props["params"] }) {
  const { slug } = await params;
  const [t, tp, callout] = await Promise.all([
    getTranslations("participant.register"),
    getTranslations("participant"),
    getTranslations("common.callout"),
  ]);
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const form = await as(actor).individualRegistrationForm({
    competitionSlug: slug,
  });
  // The proxy has already answered an unknown or draft competition with
  // the 404; this covers one unpublished since.
  if (!form) notFound();
  const competition = form.competition.name;
  const blocked = refusalBeforeForm(form);
  if (blocked) {
    return (
      <>
        <PageHeader
          eyebrow={t("eyebrow")}
          tile={HUE}
          title={t("title", { competition })}
        />
        <Callout tone="info" className="mt-8">
          <p>{tp(refusalView(blocked).message as "register.minor")}</p>
          <p>
            <SiteLink
              href={slugHref("competition", form.competition.slug)}
              className={inlineLink}
            >
              {t("backToCompetition", { competition })}
            </SiteLink>
          </p>
        </Callout>
        <SchoolNote />
      </>
    );
  }
  const fee =
    form.fee === null
      ? null
      : form.fee.amountMinor === 0n
        ? t("free")
        : t("fee", { amount: formatPaise(form.fee.amountMinor) });

  const labels: RegisterFormLabels = {
    fields: {
      fullName: t("fields.fullName"),
      dateOfBirth: t("fields.dateOfBirth"),
      phone: t("fields.phone"),
      pinCode: t("fields.pinCode"),
      city: t("fields.city"),
      state: t("fields.state"),
      country: t("fields.country"),
      schoolName: t("fields.schoolName"),
      consents: t("fields.consents"),
    },
    hints: {
      dateOfBirth: t("fields.dateOfBirthHint"),
      phone: t("fields.phoneHint"),
    },
    invalid: Object.fromEntries(
      [...TEXT_FIELDS, "consents"].map((field) => [
        field,
        t(`invalid.${field}` as `invalid.fullName`),
      ])
    ) as Record<FormField, string>,
    refusals: Object.fromEntries(
      REFUSALS.map((refusal) => [
        refusal,
        tp(refusalView(refusal).message as "register.minor"),
      ])
    ) as Record<Refusal, string>,
    documents: form.documents.map((document) => ({
      documentId: document.documentId,
      label: t("consent", { title: document.title }),
      link: t("consentLink", { title: document.title }),
      href: document.href,
    })),
    countries: countryOptions(),
    countryPlaceholder: t("countryPlaceholder"),
    problems: t("problems"),
    unexpected: t("unexpected"),
    submit: t("submit"),
    submitting: t("submitting"),
    dashboardLink: t("dashboardLink"),
    registered: t("registered"),
    continueLink: t("continueLink"),
    problem: callout("danger"),
    success: callout("success"),
  };

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile={HUE}
        title={t("title", { competition })}
        lead={t("lead")}
      />
      <SchoolNote />
      {fee ? (
        <p className="mt-6 text-lead font-semibold text-ink">{fee}</p>
      ) : null}
      <div className="mt-8">
        <RegisterForm competitionSlug={form.competition.slug} labels={labels} />
      </div>
    </>
  );
}

/** The "enter through your school" note, as on the chooser. */
async function SchoolNote() {
  const note = await getTranslations("participant.schoolNote");
  return (
    <div className="mt-8 rounded-3xl border-2 border-green-700 bg-surface p-5 shadow-warm sm:p-6 dark:border-green-400">
      <h2 id="school-note" className="text-lead font-bold text-ink">
        {note("title")}
      </h2>
      <p className="mt-2 text-ink-muted">{note("body")}</p>
      <p className="mt-2 text-ink-muted">{note("ask")}</p>
      <p className="mt-2">
        <SiteLink href={ROUTES.schools.path} className={inlineLink}>
          {note("link")}
        </SiteLink>
      </p>
    </div>
  );
}
