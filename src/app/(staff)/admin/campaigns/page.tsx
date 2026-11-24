import { CircleCheck, PencilLine, Plus, Send } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import messages from "@/../messages/en-IN/campaigns.json";
import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ADMIN_NEW_CAMPAIGN, adminCampaignPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { CampaignSummary } from "@/server/modules/campaigns";

import { isRefusal } from "../_lib/refusal";
import { CampaignsDenied } from "./_components/denied";

export const metadata: Metadata = {
  ...messages.campaigns.admin.meta,
  robots: { index: false, follow: false },
};

export default async function Page() {
  const t = await getTranslations("campaigns.admin");
  return (
    <Section hue="teal" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="teal"
        title={t("title")}
        lead={t("lead")}
      />
      {/* The actor is read per request, so the list streams in behind
          this boundary while the heading above is prerendered. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Campaigns />
      </Suspense>
    </Section>
  );
}

/** Runs the page's use case; undefined when the policy refuses. */
async function load(): Promise<CampaignSummary[] | undefined> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    return (await as(actor).listCampaigns()).campaigns;
  } catch (error) {
    if (isRefusal(error)) return undefined;
    throw error;
  }
}

const LINK =
  "inline-flex min-h-11 items-center font-semibold wrap-anywhere text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

const CARD =
  "flex flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function Campaigns() {
  const [campaigns, t, format] = await Promise.all([
    load(),
    getTranslations("campaigns.admin.index"),
    getFormatter(),
  ]);
  if (!campaigns) return <CampaignsDenied />;
  return (
    <div className="mt-8 flex flex-col gap-8">
      <div>
        <ButtonLink href={ADMIN_NEW_CAMPAIGN}>
          <Plus aria-hidden="true" />
          {t("new")}
        </ButtonLink>
      </div>
      <section aria-labelledby="campaigns-list" className="flex flex-col gap-4">
        <h2 id="campaigns-list" className="text-h3 text-ink">
          {t("listTitle")}
        </h2>
        {campaigns.length === 0 ? (
          <p className="text-ink-muted">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {campaigns.map((campaign) => (
              <li key={campaign.id} className={CARD}>
                <h3 className="text-lead font-bold break-words text-ink">
                  {campaign.subject}
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  {campaign.status === "sent" ? (
                    <Chip
                      tone="green"
                      icon={<CircleCheck aria-hidden="true" />}
                    >
                      {t("sent")}
                    </Chip>
                  ) : campaign.status === "sending" ? (
                    <Chip tone="blue" icon={<Send aria-hidden="true" />}>
                      {t("sending")}
                    </Chip>
                  ) : (
                    <Chip
                      tone="marigold"
                      icon={<PencilLine aria-hidden="true" />}
                    >
                      {t("draft")}
                    </Chip>
                  )}
                  <p className="text-ink-muted">
                    {campaign.sentAt
                      ? t("sentOn", {
                          date: format.dateTime(
                            campaign.sentAt,
                            "longDateTime"
                          ),
                          count: campaign.recipients ?? 0,
                        })
                      : t("created", {
                          date: format.dateTime(
                            campaign.createdAt,
                            "longDateTime"
                          ),
                        })}
                  </p>
                </div>
                <SiteLink
                  href={adminCampaignPath(campaign.id)}
                  className={LINK}
                >
                  {t("open", { subject: campaign.subject })}
                </SiteLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
