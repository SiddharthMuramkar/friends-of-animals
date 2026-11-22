import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { DEFAULT_FIELDS } from "@/server/modules/competitions/fields";

import { CompetitionsDenied } from "../_components/admin-states";
import { CompetitionForm } from "../_components/competition-form";
import { createCompetitionAction } from "../_lib/actions";
import { rawCopy } from "../_lib/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCompetitions.new.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const t = await getTranslations("adminCompetitions");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("new.title")}
        lead={t("new.lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <NewCompetition />
      </Suspense>
    </Section>
  );
}

async function NewCompetition() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  // Only competition managers see the form. A manager scoped to one
  // competition may not create; the use case refuses their save.
  try {
    await as(actor).listCompetitionsForAdmin();
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      return <CompetitionsDenied />;
    }
    throw error;
  }
  const [t, callout] = await Promise.all([
    getTranslations("adminCompetitions"),
    getTranslations("common.callout"),
  ]);
  return (
    <div className="mt-8">
      <CompetitionForm
        action={createCompetitionAction}
        initial={{
          attempt: 0,
          values: { ...DEFAULT_FIELDS, code: "", name: "", categories: [] },
          errors: {},
        }}
        labels={rawCopy(t, "form")}
        vocabulary={rawCopy(t, "vocabulary")}
        problemLabel={callout("danger")}
        submit={{ label: t("form.create"), pending: t("form.creating") }}
      />
    </div>
  );
}
