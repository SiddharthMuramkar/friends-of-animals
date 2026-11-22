import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { INSTITUTION_TYPES } from "@/server/modules/institutions";

import {
  RegistrationForm,
  type RegistrationFormLabels,
} from "./_components/registration-form";
import { REGISTRATION_FIELDS } from "./_lib/form-state";

// Render the document on each request so its scripts carry the CSP nonce.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("institutions.register.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  await connection();
  const t = await getTranslations("institutions.register");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* Who is asking is read per request, behind this boundary. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Register />
      </Suspense>
    </Section>
  );
}

async function Register() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const mine = await as(actor).getMyInstitution();
  // One open registration per person: theirs is on their page.
  if (mine.ok && mine.institution.status !== "rejected") {
    redirect(APP_ROUTES.myInstitution);
  }
  const [t, types, callout] = await Promise.all([
    getTranslations("institutions.register"),
    getTranslations("institutions.type"),
    getTranslations("common.callout"),
  ]);
  const labels: RegistrationFormLabels = {
    sections: {
      institution: t("sections.institution"),
      address: t("sections.address"),
      contact: t("sections.contact"),
      principal: t("sections.principal"),
    },
    fields: Object.fromEntries(
      REGISTRATION_FIELDS.map((field) => [
        field,
        {
          label: t(`fields.${field}.label`),
          error: t(`fields.${field}.error`),
        },
      ])
    ) as RegistrationFormLabels["fields"],
    types: Object.fromEntries(
      INSTITUTION_TYPES.map((type) => [type, types(type)])
    ) as RegistrationFormLabels["types"],
    alerts: {
      invalid_input: t("alerts.invalid_input"),
      already_registered: t("alerts.already_registered"),
      unexpected: t("alerts.unexpected"),
    },
    submit: t("submit"),
    submitting: t("submitting"),
    myInstitution: t("myInstitution"),
    problem: callout("danger"),
  };
  const hints = {
    address: t("fields.address.hint"),
    pinCode: t("fields.pinCode.hint"),
    contactPhone: t("fields.contactPhone.hint"),
    principalEmail: t("fields.principalEmail.hint"),
    principalPhone: t("fields.principalPhone.hint"),
    expectedParticipants: t("fields.expectedParticipants.hint"),
  };
  for (const [field, hint] of Object.entries(hints)) {
    labels.fields[field as keyof typeof hints].hint = hint;
  }
  return (
    <div className="mt-8">
      <RegistrationForm labels={labels} />
    </div>
  );
}
