import { Suspense } from "react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { ButtonLink } from "@/components/site/button-link";
import { EventInfo } from "@/components/events/event-info";
import { as } from "@/server/app";
import { PUBLIC_READER } from "../competitions/_lib/public-reader";
import { pageMetadata } from "@/lib/seo";
import { slugHref } from "@/lib/routes";
export async function generateMetadata() {
  const t = await getTranslations("events");
  return pageMetadata({
    title: t("title"),
    description: t("lead"),
    path: "/events",
  });
}
export default async function Page() {
  const t = await getTranslations("events");
  return (
    <Section hue="green" tone="tint" className="min-h-svh pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("lead")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Events />
      </Suspense>
    </Section>
  );
}
async function Events() {
  await connection();
  const [data, t] = await Promise.all([
    as(PUBLIC_READER).listPublishedEvents(),
    getTranslations("events"),
  ]);
  return data.items.length ? (
    <ul className="mt-8 grid gap-5 sm:grid-cols-2">
      {data.items.map((event) => (
        <li
          key={event.id}
          className="min-w-0 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm"
        >
          <h2 className="text-h3 text-ink wrap-anywhere">{event.title}</h2>
          <EventInfo event={event} />
          <ButtonLink className="mt-5" href={slugHref("event", event.slug)}>
            {t("view", { title: event.title })}
          </ButtonLink>
        </li>
      ))}
    </ul>
  ) : (
    <p className="mt-8 text-ink-muted">{t("empty")}</p>
  );
}
