import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SiteLink } from "@/components/site/site-link";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { EventInfo, type PublicEvent } from "@/components/events/event-info";
import { Feedback } from "@/components/events/feedback";
import { publicEvent, PLACEHOLDER_EVENT_SLUG } from "../_lib/public-reads";
import { as, currentActor } from "@/server/app";
import { pageMetadata } from "@/lib/seo";
import { ROUTES, slugHref } from "@/lib/routes";
import { DASHBOARD_COMMUNITY, DASHBOARD_EVENTS } from "@/lib/app-routes";
import { register, cancel } from "@/app/dashboard/events/actions";

export function generateStaticParams() {
  return [{ slug: PLACEHOLDER_EVENT_SLUG }];
}
export async function generateMetadata({
  params,
}: PageProps<"/events/[slug]">) {
  const { slug } = await params;
  const event = await publicEvent(slug);
  if (!event) return {};
  return pageMetadata({
    title: event.title,
    description: event.summary,
    path: slugHref("event", slug),
  });
}
export default async function Page(props: PageProps<"/events/[slug]">) {
  const t = await getTranslations("events");
  return (
    <Section hue="green" tone="tint" className="min-h-svh pt-10 sm:pt-14">
      <ButtonLink href="/events" variant="quiet">
        {t("back")}
      </ButtonLink>
      <PageHeader
        className="mt-5"
        title={t("detailTitle")}
        lead={t("detailLead")}
      />
      <Suspense
        fallback={
          <div className="mt-8 min-h-100 max-w-2xl rounded-3xl border border-border bg-surface p-5">
            <p className="text-ink-muted">{t("loading")}</p>
          </div>
        }
      >
        <Details {...props} />
      </Suspense>
    </Section>
  );
}
async function Details({ params, searchParams }: PageProps<"/events/[slug]">) {
  await connection();
  const { slug } = await params;
  const [event, t, query] = await Promise.all([
    publicEvent(slug),
    getTranslations("events"),
    searchParams,
  ]);
  if (!event) notFound();
  return (
    <article className="mt-8 max-w-2xl rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6">
      <h2 className="text-h3 wrap-anywhere text-ink">{event.title}</h2>
      <EventInfo event={event} detail />
      <Feedback result={query.result} />
      <Suspense
        fallback={<p className="mt-4 text-ink-muted">{t("loading")}</p>}
      >
        <RegistrationPanel event={event} />
      </Suspense>
    </article>
  );
}
async function RegistrationPanel({ event }: { event: PublicEvent }) {
  const [actor, t] = await Promise.all([
    currentActor(),
    getTranslations("events"),
  ]);
  if (event.status !== "published") return null;
  const path = slugHref("event", event.slug);
  if (actor.kind !== "user")
    return event.registrationWindow.state === "open" ? (
      <ButtonLink
        className="mt-5"
        href={ROUTES.signIn.path + "?next=" + encodeURIComponent(path)}
      >
        {t("signIn")}
      </ButtonLink>
    ) : null;
  const mine = (await as(actor).listMyEventRegistrations()).find(
    (row) => row.event.id === event.id && row.status !== "cancelled"
  );
  return (
    <div className="mt-6 flex flex-col items-start gap-4">
      <p className="text-ink-muted">
        {t("safeguarding")}{" "}
        <SiteLink
          className="text-link underline"
          href={ROUTES.safeguarding.path}
        >
          {t("safeguardingLink")}
        </SiteLink>
      </p>
      {mine ? (
        <>
          <p className="font-bold text-ink">
            {t(`registrationStatus.${mine.status}`)}
            {mine.position
              ? ` · ${t("waitlistPosition", { position: mine.position })}`
              : ""}
          </p>
          {mine.status === "registered" || mine.status === "waitlisted" ? (
            <form action={cancel.bind(null, mine.id, event.slug, undefined)}>
              <button
                type="submit"
                className={buttonStyles({ variant: "secondary" })}
              >
                {t("cancelRegistration")}
              </button>
            </form>
          ) : null}
        </>
      ) : event.registrationWindow.state === "open" ? (
        <form action={register.bind(null, event.id, event.slug, undefined)}>
          <button type="submit" className={buttonStyles()}>
            {t("register")}
          </button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={DASHBOARD_EVENTS} variant="secondary">
          {t("my")}
        </ButtonLink>
        {event.audience === "members" ? (
          <ButtonLink href={DASHBOARD_COMMUNITY} variant="quiet">
            {t("join")}
          </ButtonLink>
        ) : null}
      </div>
      <p className="text-ink-muted">{t("children")}</p>
    </div>
  );
}
