import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import messages from "@/../messages/en-IN/campaigns.json";
import { FormAlert } from "@/components/form";
import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ADMIN_CAMPAIGNS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type {
  CampaignPreview,
  SegmentCompetition,
  SegmentDefinition,
} from "@/server/modules/campaigns";

import { isRefusal } from "../../_lib/refusal";
import { CampaignForm } from "../_components/campaign-form";
import { CampaignNotFound, CampaignsDenied } from "../_components/denied";
import { SendConfirmation } from "../_components/send-confirmation";
import { campaignFormView } from "../_lib/form";
import { readOutcome, type Outcome } from "../_lib/href";
import {
  competitionChoices,
  formLabels,
  roleChoices,
  milestoneChoices,
} from "../_lib/labels";

export const metadata: Metadata = {
  ...messages.campaigns.admin.meta,
  title: messages.campaigns.admin.detail.title,
  robots: { index: false, follow: false },
};

type Props = PageProps<"/admin/campaigns/[id]">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("campaigns.admin");
  return (
    <Section hue="teal" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader eyebrow={t("title")} tile="teal" title={t("detail.title")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const LINK =
  "inline-flex min-h-11 self-start items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

const PANEL = "space-y-3 rounded-3xl border-2 border-border bg-surface p-5";

type Loaded =
  | { kind: "denied" }
  | { kind: "missing" }
  | {
      kind: "found";
      preview: CampaignPreview;
      competitions: SegmentCompetition[];
    };

async function load(id: string): Promise<Loaded> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    const useCases = as(actor);
    const [preview, competitions] = await Promise.all([
      useCases.previewCampaign({ id }),
      useCases.listSegmentCompetitions(),
    ]);
    if (!preview.ok) return { kind: "missing" };
    return { kind: "found", preview, competitions };
  } catch (error) {
    if (isRefusal(error)) return { kind: "denied" };
    throw error;
  }
}

async function Detail({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const [{ id }, search, t, format] = await Promise.all([
    params,
    searchParams,
    getTranslations("campaigns.admin"),
    getFormatter(),
  ]);
  const loaded = await load(id);
  if (loaded.kind === "denied") return <CampaignsDenied />;
  if (loaded.kind === "missing") return <CampaignNotFound />;
  const { preview, competitions } = loaded;
  const { campaign, counts, delivered } = preview;
  const draft = campaign.status === "draft";

  return (
    <div className="mt-8 flex flex-col gap-8">
      <SiteLink href={ADMIN_CAMPAIGNS} className={LINK}>
        {t("detail.back")}
      </SiteLink>
      <div>
        <h2 className="mb-2 text-h2 wrap-anywhere text-ink">
          {campaign.subject}
        </h2>
        <Chip
          tone={
            campaign.status === "sent"
              ? "green"
              : campaign.status === "sending"
                ? "blue"
                : "marigold"
          }
        >
          {t(`index.${campaign.status}`)}
        </Chip>
      </div>
      <Notice outcome={readOutcome(search)} />
      <SegmentSummary segment={campaign.segment} competitions={competitions} />
      {draft ? (
        <>
          <section className="space-y-4">
            <SectionHeading id="edit-campaign" title={t("form.editTitle")} />
            <CampaignForm
              key={campaign.revision}
              campaignId={campaign.id}
              revision={campaign.revision}
              initial={campaignFormView(campaign)}
              roles={await roleChoices()}
              milestones={await milestoneChoices()}
              competitions={competitionChoices(competitions)}
              labels={await formLabels("save")}
              labelledBy="edit-campaign"
            />
          </section>
          <section className="space-y-4">
            <SectionHeading title={t("preview.title")} />
            <p>{t("preview.lead")}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li className="font-semibold">
                {t("preview.reach", { count: counts.recipients })}
              </li>
              <li>{t("preview.matched", { count: counts.matched })}</li>
              <li>{t("preview.noConsent", { count: counts.noConsent })}</li>
              {counts.noGuardian > 0 ? (
                <li>{t("preview.noGuardian", { count: counts.noGuardian })}</li>
              ) : null}
            </ul>
            <p>{t("preview.guardians")}</p>
            <div className={PANEL}>
              <h3 className="text-h4">{t("preview.email")}</h3>
              <p className="wrap-anywhere">
                <strong>{t("preview.emailSubject")}</strong>{" "}
                {preview.email.subject}
              </p>
              <p className="wrap-anywhere whitespace-pre-wrap">
                {preview.email.body}
              </p>
            </div>
            <div className={PANEL}>
              <h3 className="text-h4">{t("preview.inApp")}</h3>
              <p className="font-semibold wrap-anywhere">
                {preview.inApp.subject}
              </p>
              <p className="wrap-anywhere whitespace-pre-wrap">
                {preview.inApp.body}
              </p>
            </div>
            <SendConfirmation
              key={campaign.revision}
              campaignId={campaign.id}
              revision={campaign.revision}
              labels={{
                title: t("send.title"),
                count: t("send.confirm", { count: counts.recipients }),
                lead: t("send.lead"),
                send: t("send.button"),
                sending: t("send.sending"),
                cancel: t("send.cancel"),
              }}
            />
          </section>
        </>
      ) : (
        <>
          <section className="space-y-3">
            <SectionHeading title={t("progress.title")} />
            {campaign.sentAt ? (
              <p>
                {t("progress.sentOn", {
                  date: format.dateTime(campaign.sentAt, "longDateTime"),
                })}
              </p>
            ) : null}
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("progress.planned", { count: counts.recipients })}</li>
              <li>{t("progress.sent", { count: delivered?.sent ?? 0 })}</li>
              <li>
                {t("progress.skipped", { count: delivered?.skipped ?? 0 })}
              </li>
              <li>{t("progress.queued", { count: delivered?.queued ?? 0 })}</li>
            </ul>
            {campaign.completedAt ? (
              <p>
                {t("progress.completed", {
                  date: format.dateTime(campaign.completedAt, "longDateTime"),
                })}
              </p>
            ) : null}
          </section>
          <section className="space-y-3">
            <SectionHeading title={t("detail.contentTitle")} />
            <p className="wrap-anywhere whitespace-pre-wrap">{campaign.body}</p>
          </section>
        </>
      )}
    </div>
  );
}

async function SegmentSummary({
  segment,
  competitions,
}: {
  segment: SegmentDefinition;
  competitions: SegmentCompetition[];
}) {
  const [t, roles, format, milestones] = await Promise.all([
    getTranslations("campaigns.admin"),
    getTranslations("campaigns.admin.roles"),
    getFormatter(),
    getTranslations("community.timeline.milestones"),
  ]);
  const names = new Map(competitions.map((c) => [c.id, c.name]));
  const lines = [
    segment.roles.length > 0 &&
      t("detail.rolesLine", {
        list: format.list(
          segment.roles.map((role) => roles(role)),
          { type: "disjunction" }
        ),
      }),
    segment.competitionIds.length > 0 &&
      t("detail.competitionsLine", {
        list: format.list(
          segment.competitionIds.map((id) => names.get(id) ?? id),
          { type: "disjunction" }
        ),
      }),
    (segment.milestones?.length ?? 0) > 0 &&
      t("detail.milestonesLine", {
        list: format.list(
          (segment.milestones ?? []).map((kind) => milestones(kind)),
          { type: "disjunction" }
        ),
      }),
    segment.cities.length > 0 &&
      t("detail.citiesLine", {
        list: format.list(segment.cities, { type: "disjunction" }),
      }),
  ].filter((line): line is string => typeof line === "string");
  return (
    <section className="space-y-2">
      <SectionHeading title={t("detail.segment")} />
      {lines.length === 0 ? (
        <p>{t("detail.everyone")}</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 wrap-anywhere">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function Notice({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null;
  const [t, callout] = await Promise.all([
    getTranslations("campaigns.admin"),
    getTranslations("common.callout"),
  ]);
  if ("refused" in outcome) {
    return (
      <FormAlert key={outcome.at} tone="danger" label={callout("danger")}>
        {t(`refusals.${outcome.refused}`)}
      </FormAlert>
    );
  }
  return (
    <FormAlert key={outcome.at} tone="success" label={callout("success")}>
      {t(`detail.${outcome.done}`)}
    </FormAlert>
  );
}
