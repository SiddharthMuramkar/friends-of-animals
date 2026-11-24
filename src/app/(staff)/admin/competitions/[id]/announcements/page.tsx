import { CircleCheck, PencilLine, Plus } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import messages from "@/../messages/en-IN/adminAnnouncements.json";
import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { ListAnnouncementsResult } from "@/server/modules/announcements";

import { isRefusal } from "../../../_lib/refusal";
import { announcementHref, newAnnouncementHref } from "./_lib/href";

export const metadata: Metadata = {
  ...messages.adminAnnouncements.meta,
  robots: { index: false, follow: false },
};

type Params = PageProps<"/admin/competitions/[id]/announcements">["params"];

export default async function Page({
  params,
}: PageProps<"/admin/competitions/[id]/announcements">) {
  const t = await getTranslations("adminAnnouncements");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* The actor is read per request, so the list streams in behind
          this boundary while the heading above is prerendered. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Announcements params={params} />
      </Suspense>
    </Section>
  );
}

/** Runs the page's use case; undefined when the policy refuses. */
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
  "inline-flex min-h-11 items-center font-semibold wrap-anywhere text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

const CARD =
  "flex flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function Announcements({ params }: { params: Params }) {
  const { id } = await params;
  const [result, t, format] = await Promise.all([
    load(id),
    getTranslations("adminAnnouncements"),
    getFormatter(),
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

  const { competition, announcements } = result;
  return (
    <div className="mt-8 flex flex-col gap-8">
      <p className="text-lead text-ink">
        {t("index.competition", {
          code: competition.code,
          name: competition.name,
        })}
      </p>
      <div>
        <ButtonLink href={newAnnouncementHref(competition.id)}>
          <Plus aria-hidden="true" />
          {t("index.new")}
        </ButtonLink>
      </div>
      <section
        aria-labelledby="announcements-list"
        className="flex flex-col gap-4"
      >
        <h2 id="announcements-list" className="text-h3 text-ink">
          {t("index.listTitle")}
        </h2>
        {announcements.length === 0 ? (
          <p className="text-ink-muted">{t("index.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {announcements.map((announcement) => (
              <li key={announcement.id} className={CARD}>
                <h3 className="text-lead font-bold break-words text-ink">
                  {announcement.subject}
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  {announcement.status === "sent" ? (
                    <Chip
                      tone="green"
                      icon={<CircleCheck aria-hidden="true" />}
                    >
                      {t("index.sent")}
                    </Chip>
                  ) : (
                    <Chip
                      tone="marigold"
                      icon={<PencilLine aria-hidden="true" />}
                    >
                      {t("index.draft")}
                    </Chip>
                  )}
                  <p className="text-ink-muted">
                    {announcement.sentAt
                      ? t("index.sentOn", {
                          date: format.dateTime(
                            announcement.sentAt,
                            "longDateTime"
                          ),
                          count: announcement.recipientCount ?? 0,
                        })
                      : t("index.updated", {
                          date: format.dateTime(
                            announcement.updatedAt,
                            "longDateTime"
                          ),
                        })}
                  </p>
                </div>
                <SiteLink
                  href={announcementHref(competition.id, announcement.id)}
                  className={LINK}
                >
                  {t("index.open", { subject: announcement.subject })}
                </SiteLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
