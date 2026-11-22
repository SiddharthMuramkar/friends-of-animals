import { Inbox, MailOpen } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import {
  markAllInboxReadAction,
  markInboxItemReadAction,
} from "./_lib/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inbox.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const t = await getTranslations("inbox");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* The inbox is read per request, so it streams in behind this
          boundary while the heading above is prerendered. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Messages />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function Messages() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, format, items, unread] = await Promise.all([
    getTranslations("inbox"),
    getFormatter(),
    as(actor).listInbox(),
    as(actor).countUnread(),
  ]);

  return (
    <div className="mt-8 flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-lead text-ink">
          {t("summary", { count: unread })}
        </p>
        {unread > 0 ? (
          <form action={markAllInboxReadAction}>
            <SubmitButton variant="secondary" pendingLabel={t("marking")}>
              {t("markAll")}
            </SubmitButton>
          </form>
        ) : null}
      </div>

      <section aria-labelledby="inbox-list">
        <SectionHeading id="inbox-list" title={t("listTitle")} />
        {items.length === 0 ? (
          <ExplainState title={t("emptyTitle")} className="mt-5">
            <p>{t("emptyBody")}</p>
          </ExplainState>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {items.map((item) => {
              const isUnread = item.readAt === null;
              return (
                <li key={item.id} className={CARD}>
                  <div className="flex flex-wrap items-center gap-2">
                    {isUnread ? (
                      <Chip tone="blue" icon={<Inbox aria-hidden="true" />}>
                        {t("unread")}
                      </Chip>
                    ) : (
                      <Chip icon={<MailOpen aria-hidden="true" />}>
                        {t("read")}
                      </Chip>
                    )}
                    <p className="text-sm text-ink-muted">
                      {t("received", {
                        date: format.dateTime(item.createdAt, "longDateTime"),
                      })}
                    </p>
                  </div>
                  <h3 className="mt-3 text-lead font-bold text-ink">
                    {item.title}
                  </h3>
                  <p className="mt-2 whitespace-pre-line text-ink wrap-anywhere">
                    {item.body}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {item.link ? (
                      <ButtonLink href={item.link} variant="secondary">
                        <span aria-hidden="true">{t("open")}</span>
                        <span className="sr-only">
                          {t("openLabel", { title: item.title })}
                        </span>
                      </ButtonLink>
                    ) : null}
                    {isUnread ? (
                      <form action={markInboxItemReadAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <SubmitButton
                          variant="secondary"
                          pendingLabel={t("marking")}
                        >
                          <span aria-hidden="true">{t("markRead")}</span>
                          <span className="sr-only">
                            {t("markReadLabel", { title: item.title })}
                          </span>
                        </SubmitButton>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p>
        <ButtonLink href={APP_ROUTES.accountNotifications} variant="secondary">
          {t("choices")}
        </ButtonLink>
      </p>
    </div>
  );
}
