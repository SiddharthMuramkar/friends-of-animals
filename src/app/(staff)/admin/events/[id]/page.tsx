import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { Feedback } from "@/components/events/feedback";
import {
  ADMIN_EVENTS,
  adminEventPath,
  eventRegistrationsPath,
  eventCheckInPath,
} from "@/lib/app-routes";
import { slugHref } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { adminCall } from "../../_lib/boundary";
import { AdminDenied } from "../../_components/admin-denied";
import { EventForm } from "../_form";
import { move } from "../actions";
export async function generateMetadata() {
  const t = await getTranslations("events");
  return { title: t("edit"), robots: { index: false, follow: false } };
}
export default async function Page(props: PageProps<"/admin/events/[id]">) {
  const t = await getTranslations("events");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Details {...props} />
      </Suspense>
    </Section>
  );
}
async function Details({
  params,
  searchParams,
}: PageProps<"/admin/events/[id]">) {
  const [{ id: eventId }, actor, t, query] = await Promise.all([
    params,
    currentActor(),
    getTranslations("events"),
    searchParams,
  ]);
  const loaded = await adminCall(
    () => as(actor).getEventForAdmin({ eventId }),
    adminEventPath(eventId)
  );
  if (!loaded.ok) return <AdminDenied />;
  if (!loaded.value.ok) notFound();
  const event = loaded.value.event;
  return (
    <>
      <PageHeader title={event.title} lead={t(`status.${event.status}`)} />
      <div className="mt-5 flex flex-wrap gap-3">
        <ButtonLink href={ADMIN_EVENTS} variant="quiet">
          {t("back")}
        </ButtonLink>
        {event.publishedAt ? (
          <>
            <ButtonLink
              href={slugHref("event", event.slug)}
              variant="secondary"
            >
              {t("view", { title: event.title })}
            </ButtonLink>
            <ButtonLink
              href={eventRegistrationsPath(event.id)}
              variant="secondary"
            >
              {t("registrations")}
            </ButtonLink>
            <ButtonLink href={eventCheckInPath(event.id)} variant="secondary">
              {t("sheet")}
            </ButtonLink>
          </>
        ) : null}
      </div>
      <Feedback result={query.result} />
      <div className="mt-5 flex flex-wrap gap-3">
        {event.status === "draft" ? (
          <form action={move.bind(null, event.id, "publish")}>
            <button className={buttonStyles()} type="submit">
              {t("publish")}
            </button>
          </form>
        ) : null}
        {event.status === "draft" || event.status === "published" ? (
          <form action={move.bind(null, event.id, "cancel")}>
            <button
              className={buttonStyles({ variant: "secondary" })}
              type="submit"
            >
              {t("cancel")}
            </button>
          </form>
        ) : null}
        {event.status === "published" ? (
          <form action={move.bind(null, event.id, "complete")}>
            <button
              className={buttonStyles({ variant: "secondary" })}
              type="submit"
            >
              {t("complete")}
            </button>
          </form>
        ) : null}
      </div>
      {event.status === "draft" || event.status === "published" ? (
        <EventForm event={event} />
      ) : null}
    </>
  );
}
