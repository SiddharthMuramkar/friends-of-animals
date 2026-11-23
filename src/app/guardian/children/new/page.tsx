import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { GUARDIAN_RELATIONSHIPS } from "@/server/modules/registration/domain/student-details";

import {
  ADD_CHILD_FIELDS,
  type AddChildField,
  type AddChildRefusal,
} from "../../_lib/form-state";
import { AddChildForm } from "./_components/add-child-form";

// Adding a child (#81), for a verified guardian. Anyone else is sent to
// register or verify first.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("guardian.newChild.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const HUE = "green";

const REFUSALS: readonly AddChildRefusal[] = [
  "dob_invalid",
  "adult",
  "already_added",
  "unexpected",
];

export default async function Page() {
  const t = await getTranslations("guardian.newChild");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile={HUE}
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <NewChild />
      </Suspense>
    </Section>
  );
}

async function NewChild() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, callout, profile] = await Promise.all([
    getTranslations("guardian.newChild"),
    getTranslations("common.callout"),
    as(actor).myGuardianProfile(),
  ]);
  if (!profile.registered || !profile.verified) {
    redirect(APP_ROUTES.guardianRegister);
  }
  return (
    <div className="mt-8 flex flex-col gap-6">
      <AddChildForm
        labels={{
          fields: Object.fromEntries(
            ADD_CHILD_FIELDS.map((field) => [field, t(`fields.${field}`)])
          ) as Record<AddChildField, string>,
          relationshipPlaceholder: t("fields.relationshipPlaceholder"),
          relationships: GUARDIAN_RELATIONSHIPS.map((value) => ({
            value,
            label: t(`relationships.${value}`),
          })),
          invalid: Object.fromEntries(
            ADD_CHILD_FIELDS.map((field) => [field, t(`invalid.${field}`)])
          ) as Record<AddChildField, string>,
          refusals: Object.fromEntries(
            REFUSALS.map((refusal) => [refusal, t(`refusals.${refusal}`)])
          ) as Record<AddChildRefusal, string>,
          fixFields: t("problems"),
          submit: t("submit"),
          submitting: t("submitting"),
          problem: callout("danger"),
        }}
      />
      <p>
        <SiteLink href={APP_ROUTES.guardian} className={inlineLink}>
          {t("back")}
        </SiteLink>
      </p>
    </div>
  );
}
