import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import messages from "@/../messages/en-IN/adminAnnouncements.json";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { ListAnnouncementsResult } from "@/server/modules/announcements";

import { isRefusal } from "../../../../_lib/refusal";
import { AnnouncementForm } from "../_components/announcement-form";
import { announcementFormView } from "../_lib/form";
import { announcementsHref } from "../_lib/href";
import { formLabels } from "../_lib/labels";

export const metadata: Metadata = {
  ...messages.adminAnnouncements.meta,
  title: messages.adminAnnouncements.form.newTitle,
  robots: { index: false, follow: false },
};

type Params = PageProps<"/admin/competitions/[id]/announcements/new">["params"];

export default async function Page({
  params,
}: PageProps<"/admin/competitions/[id]/announcements/new">) {
  const t = await getTranslations("adminAnnouncements");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        id="new-announcement-title"
        eyebrow={t("title")}
        tile="blue"
        title={t("form.newTitle")}
        lead={t("form.lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Composer params={params} />
      </Suspense>
    </Section>
  );
}

/** Whether the actor may write here, and the competition; undefined if not. */
async function load(
  competitionId: string
): Promise<ListAnnouncementsResult | undefined> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    return await as(actor).listAnnouncements({ competitionId });
  } catch (error) {
    if (isRefusal(error)) return undefined;
    throw error;
  }
}

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

async function Composer({ params }: { params: Params }) {
  const { id } = await params;
  const [result, t, labels] = await Promise.all([
    load(id),
    getTranslations("adminAnnouncements"),
    formLabels("create"),
  ]);
  if (!result) {
    return (
      <ExplainState
        title={t("denied.title")}
        back={{ href: APP_ROUTES.dashboard, label: t("denied.back") }}
        className="mt-8"
      >
        <p>{t("denied.body")}</p>
      </ExplainState>
    );
  }
  if (!result.ok) {
    return (
      <ExplainState
        title={t("notFound.title")}
        back={{ href: APP_ROUTES.dashboard, label: t("notFound.back") }}
        className="mt-8"
      >
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }
  return (
    <div className="mt-8 flex flex-col gap-8">
      <p className="text-lead text-ink">
        {t("index.competition", {
          code: result.competition.code,
          name: result.competition.name,
        })}
      </p>
      <AnnouncementForm
        competitionId={result.competition.id}
        announcementId={null}
        initial={announcementFormView(null)}
        labels={labels}
        labelledBy="new-announcement-title"
      />
      <SiteLink
        href={announcementsHref(result.competition.id)}
        className={LINK}
      >
        {t("detail.back")}
      </SiteLink>
    </div>
  );
}
