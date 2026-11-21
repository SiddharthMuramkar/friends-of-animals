import { BadgeCheck, CircleSlash } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { messages } from "@/i18n/messages";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { Refused } from "./_components/refused";
import { nameOr, type NameTree } from "./_lib/labels";
import { unlessRefused } from "./_lib/refusal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminTemplates.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const t = await getTranslations("adminTemplates");
  return (
    <Section hue="teal" tone="tint" width="wide" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="teal"
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Templates />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function Templates() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, loaded] = await Promise.all([
    getTranslations("adminTemplates"),
    unlessRefused(() => as(actor).listMessageTemplates()),
  ]);
  if (!loaded.ok) return <Refused refusal={loaded.refusal} className="mt-8" />;
  const templates = loaded.value;

  const eventNames: NameTree = messages.adminTemplates.events;
  const keyNames: NameTree = messages.adminTemplates.keys;
  const sentWhen = (events: string[]) => {
    const names = events.map((type) => nameOr(eventNames, type));
    if (names.length === 0) return t("notSent");
    const joined = names
      .slice(1)
      .reduce((first, second) => t("eventsJoin", { first, second }), names[0]!);
    return t("sentWhen", { events: joined });
  };

  return (
    <section aria-labelledby="templates-list" className="mt-8">
      <SectionHeading id="templates-list" title={t("listTitle")} />
      <ul className="mt-5 grid gap-4 md:grid-cols-2">
        {templates.map((template) => {
          const name = nameOr(keyNames, template.key);
          return (
            <li key={template.key} className={CARD}>
              <h3 className="text-lead font-bold text-ink">{name}</h3>
              <p className="mt-1 font-mono text-sm text-ink-muted wrap-anywhere">
                {template.key}
              </p>
              <p className="mt-3 text-ink">{sentWhen(template.events)}</p>
              <ul className="mt-4 flex flex-col gap-2">
                {template.channels.map((channel) => (
                  <li
                    key={channel.channel}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="font-semibold text-ink">
                      {t(`channels.${channel.channel}`)}
                    </span>
                    <span className="text-ink-muted">
                      {t("version", { version: channel.version })}
                    </span>
                    {channel.channel === "sms" ? (
                      channel.dltTemplateId ? (
                        <Chip
                          tone="green"
                          icon={<BadgeCheck aria-hidden="true" />}
                        >
                          {t("registered")}
                        </Chip>
                      ) : (
                        <Chip icon={<CircleSlash aria-hidden="true" />}>
                          {t("unregistered")}
                        </Chip>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
              <ButtonLink
                href={`${APP_ROUTES.adminTemplates}/${encodeURIComponent(template.key)}`}
                variant="secondary"
                className="mt-5"
              >
                <span aria-hidden="true">{t("edit")}</span>
                <span className="sr-only">{t("editLabel", { name })}</span>
              </ButtonLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
