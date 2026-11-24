import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { env } from "@/env";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { guardianFlowsActive } from "@/server/modules/guardians/availability";

import { GuardianDashboard } from "./_components/guardian-dashboard";

// A guardian's children (#81): who they look after, the kind of profile
// each child's age gives, and where each child's own login stands. Setup
// actions are available while the guardian flows are open.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("guardian.home.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const HUE = "green";

export default async function Page() {
  const t = await getTranslations("guardian.home");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader eyebrow={t("eyebrow")} tile={HUE} title={t("title")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Children lead={t("lead")} />
      </Suspense>
    </Section>
  );
}

async function Children({ lead }: { lead: string }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const guardian = as(actor);
  const profile = await guardian.myGuardianProfile();
  const childProfiles =
    profile.registered && profile.verified ? await guardian.listChildren() : [];
  const setupAvailable = guardianFlowsActive(env().APP_ENV);
  return (
    <>
      {setupAvailable ? (
        <p className="mt-5 max-w-prose text-lead text-ink-muted">{lead}</p>
      ) : null}
      <GuardianDashboard
        profile={profile}
        childProfiles={childProfiles}
        setupAvailable={setupAvailable}
      />
    </>
  );
}
