import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import messages from "@/../messages/en-IN/campaigns.json";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ADMIN_CAMPAIGNS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { SegmentCompetition } from "@/server/modules/campaigns";

import { isRefusal } from "../../_lib/refusal";
import { CampaignForm } from "../_components/campaign-form";
import { CampaignsDenied } from "../_components/denied";
import { campaignFormView } from "../_lib/form";
import {
  competitionChoices,
  formLabels,
  roleChoices,
  milestoneChoices,
} from "../_lib/labels";

export const metadata: Metadata = {
  ...messages.campaigns.admin.meta,
  title: messages.campaigns.admin.form.newTitle,
  robots: { index: false, follow: false },
};

export default async function Page() {
  const t = await getTranslations("campaigns.admin");
  return (
    <Section hue="teal" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        id="new-campaign-title"
        eyebrow={t("title")}
        tile="teal"
        title={t("form.newTitle")}
        lead={t("form.newLead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Composer />
      </Suspense>
    </Section>
  );
}

/** The competitions a segment can name; undefined when the policy refuses. */
async function load(): Promise<SegmentCompetition[] | undefined> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    return await as(actor).listSegmentCompetitions();
  } catch (error) {
    if (isRefusal(error)) return undefined;
    throw error;
  }
}

const LINK =
  "inline-flex min-h-11 self-start items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

async function Composer() {
  const [competitions, t, labels, roles] = await Promise.all([
    load(),
    getTranslations("campaigns.admin.detail"),
    formLabels("create"),
    roleChoices(),
  ]);
  if (!competitions) return <CampaignsDenied />;
  return (
    <div className="mt-8 flex flex-col gap-8">
      <CampaignForm
        campaignId={null}
        revision={null}
        initial={campaignFormView(null)}
        roles={roles}
        milestones={await milestoneChoices()}
        competitions={competitionChoices(competitions)}
        labels={labels}
        labelledBy="new-campaign-title"
      />
      <SiteLink href={ADMIN_CAMPAIGNS} className={LINK}>
        {t("back")}
      </SiteLink>
    </div>
  );
}
