import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import messages from "@/../messages/en-IN/adminAnnouncements.json";
import { FormAlert } from "@/components/form";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { AnnouncementPreview } from "@/server/modules/announcements";
import { announcementBody } from "@/server/modules/announcements/render";

import { isRefusal } from "../../../../_lib/refusal";
import { AnnouncementForm } from "../_components/announcement-form";
import { SendConfirmation } from "../_components/send-confirmation";
import { announcementFormView } from "../_lib/form";
import { announcementsHref, readOutcome, type Outcome } from "../_lib/href";
import { formLabels } from "../_lib/labels";

export const metadata: Metadata = {
  ...messages.adminAnnouncements.meta,
  title: messages.adminAnnouncements.detail.title,
  robots: { index: false, follow: false },
};

type Props =
  PageProps<"/admin/competitions/[id]/announcements/[announcementId]">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminAnnouncements");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader eyebrow={t("title")} tile="blue" title={t("detail.title")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Detail({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const [{ id, announcementId }, search, actor, t, format] = await Promise.all([
    params,
    searchParams,
    currentActor(),
    getTranslations("adminAnnouncements"),
    getFormatter(),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const useCases = as(actor);
  const target = { competitionId: id, id: announcementId };
  let result;
  let preview: AnnouncementPreview | undefined;
  try {
    result = await useCases.getAnnouncement(target);
    if (result.ok && result.announcement.status === "draft") {
      const rendered = await useCases.previewAnnouncement(target);
      if (rendered.ok) preview = rendered.preview;
    }
  } catch (error) {
    if (!isRefusal(error)) throw error;
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
  const list = announcementsHref(id);
  if (!result.ok || (result.announcement.status === "draft" && !preview)) {
    return (
      <ExplainState
        title={t("notFound.title")}
        back={{ href: list, label: t("detail.back") }}
        className="mt-8"
      >
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }

  const { announcement, competition } = result;
  const { content, sentAt, recipientCount } = announcement;
  const count = recipientCount ?? 0;
  return (
    <div className="mt-8 flex flex-col gap-8">
      <SiteLink
        href={list}
        className="inline-flex min-h-11 self-start items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover"
      >
        {t("detail.back")}
      </SiteLink>
      <div>
        <p className="text-ink-muted">
          {t("index.competition", {
            code: competition.code,
            name: competition.name,
          })}
        </p>
        <h2 className="my-2 text-h2 wrap-anywhere text-ink">
          {content.subject}
        </h2>
        <Chip tone={sentAt ? "green" : "marigold"}>
          {t(sentAt ? "index.sent" : "index.draft")}
        </Chip>
      </div>
      <Notice outcome={readOutcome(search)} count={count} />
      {sentAt ? (
        <section className="space-y-4">
          <p>
            {t("detail.sentSummary", {
              count,
              date: format.dateTime(sentAt, "longDateTime"),
            })}
          </p>
          <SectionHeading title={t("detail.contentTitle")} />
          <p className="wrap-anywhere whitespace-pre-wrap">
            {announcementBody(content)}
          </p>
        </section>
      ) : preview ? (
        <>
          <section className="space-y-4">
            <SectionHeading
              id="edit-announcement"
              title={t("form.editTitle")}
            />
            <AnnouncementForm
              key={announcement.revision}
              competitionId={id}
              announcementId={announcementId}
              initial={announcementFormView(content)}
              labels={await formLabels("save")}
              labelledBy="edit-announcement"
            />
          </section>
          <section className="space-y-4">
            <SectionHeading title={t("preview.title")} />
            <p>{t("preview.lead")}</p>
            <p>{t("preview.counts", preview.counts)}</p>
            {preview.counts.unreachable > 0 && (
              <p>
                {t("preview.unreachable", {
                  count: preview.counts.unreachable,
                })}
              </p>
            )}
            <div className="space-y-3 rounded-3xl border-2 border-border bg-surface p-5">
              <h3 className="text-h4">{t("preview.email")}</h3>
              <p className="wrap-anywhere">
                <strong>{t("preview.emailSubject")}</strong>{" "}
                {preview.email.subject}
              </p>
              <p className="wrap-anywhere whitespace-pre-wrap">
                {preview.email.text}
              </p>
            </div>
            <div className="space-y-3 rounded-3xl border-2 border-border bg-surface p-5">
              <h3 className="text-h4">{t("preview.inApp")}</h3>
              <p className="font-semibold wrap-anywhere">
                {preview.inApp.title}
              </p>
              <p className="wrap-anywhere whitespace-pre-wrap">
                {preview.inApp.body}
              </p>
            </div>
            <SendConfirmation
              key={preview.revision}
              competitionId={id}
              announcementId={announcementId}
              revision={preview.revision}
              labels={{
                title: t("send.title"),
                count: t("send.confirm", { count: preview.counts.recipients }),
                lead: t("send.lead"),
                send: t("send.button"),
                sending: t("send.sending"),
                cancel: t("send.cancel"),
              }}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}

async function Notice({ outcome, count }: { outcome: Outcome; count: number }) {
  if (!outcome) return null;
  const [t, callout] = await Promise.all([
    getTranslations("adminAnnouncements"),
    getTranslations("common.callout"),
  ]);
  if ("refused" in outcome) {
    return (
      <FormAlert key={outcome.at} tone="danger" label={callout("danger")}>
        {outcome.refused === "unconfirmed"
          ? t("send.unconfirmed")
          : t(`refusals.${outcome.refused}`)}
      </FormAlert>
    );
  }
  return (
    <FormAlert key={outcome.at} tone="success" label={callout("success")}>
      {outcome.done === "sent"
        ? t("detail.sentDone", { count })
        : t(`detail.${outcome.done}`)}
    </FormAlert>
  );
}
