import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { Feedback } from "@/components/events/feedback";
import {
  adminEventPath,
  eventRegistrationsPath,
  eventCheckInPath,
} from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { adminCall } from "../../../_lib/boundary";
import { AdminDenied } from "../../../_components/admin-denied";
import { cancelBooking } from "../../actions";
export async function generateMetadata() {
  const t = await getTranslations("events");
  return { title: t("registrations"), robots: { index: false, follow: false } };
}
export default async function Page(
  props: PageProps<"/admin/events/[id]/registrations">
) {
  const t = await getTranslations("events");
  return (
    <Section hue="green" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader title={t("registrations")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <List {...props} />
      </Suspense>
    </Section>
  );
}
async function List({
  params,
  searchParams,
}: PageProps<"/admin/events/[id]/registrations">) {
  const [{ id: eventId }, actor, t, format, query] = await Promise.all([
    params,
    currentActor(),
    getTranslations("events"),
    getFormatter(),
    searchParams,
  ]);
  const api = as(actor);
  const loaded = await adminCall(
    () =>
      Promise.all([
        api.getEventForAdmin({ eventId }),
        api.listEventRegistrations({ eventId }),
        api.getEventPlaces({ eventId }),
      ]),
    eventRegistrationsPath(eventId)
  );
  if (!loaded.ok) return <AdminDenied />;
  const [details, list, places] = loaded.value;
  if (!details.ok || !list.ok || !places.ok) notFound();
  return (
    <div className="mt-8 flex flex-col gap-5">
      <h2 className="text-h3 text-ink wrap-anywhere">{details.event.title}</h2>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href={adminEventPath(eventId)} variant="quiet">
          {t("edit")}
        </ButtonLink>
        <ButtonLink href={eventCheckInPath(eventId)} variant="secondary">
          {t("sheet")}
        </ButtonLink>
      </div>
      <div className="flex flex-wrap gap-4 text-ink">
        <p className="font-semibold">
          {t("registeredCount", { count: places.placesTaken })}
        </p>
        <p className="font-semibold">
          {t("waitlistedCount", { count: places.waiting })}
        </p>
      </div>
      <Feedback result={query.result} />
      {list.items.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {list.items.map((r) => (
            <li
              key={r.id}
              className="min-w-0 rounded-3xl border-2 border-border bg-surface p-5"
            >
              <h3 className="text-h4 text-ink wrap-anywhere">{r.name}</h3>
              <p className="mt-2 font-semibold text-ink">
                {t(`registrationStatus.${r.status}`)}
              </p>
              {r.position ? (
                <p className="text-ink-muted">
                  {t("waitlistPosition", { position: r.position })}
                </p>
              ) : null}
              <p className="mt-2 text-ink-muted">
                {t("booked")}: {format.dateTime(r.registeredAt, "longDateTime")}
              </p>
              {details.event.status === "published" &&
              (r.status === "registered" || r.status === "waitlisted") ? (
                <form
                  className="mt-4"
                  action={cancelBooking.bind(null, eventId, r.id)}
                >
                  <button
                    className={buttonStyles({ variant: "secondary" })}
                    type="submit"
                  >
                    {t("cancelRegistration")}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">{t("noAttendees")}</p>
      )}
    </div>
  );
}
