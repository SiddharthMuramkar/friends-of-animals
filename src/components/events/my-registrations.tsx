import { getFormatter, getTranslations } from "next-intl/server";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { SectionHeading } from "@/components/site/heading";
import { slugHref } from "@/lib/routes";
import { cancel, register } from "@/app/dashboard/events/actions";
import type { listMyEventRegistrations } from "@/server/modules/events/registrations";
import type { PublicEvent } from "./event-info";
import { EventInfo } from "./event-info";

type Bookings = Awaited<ReturnType<typeof listMyEventRegistrations>>;
export async function MyRegistrations({
  rows,
  childId,
}: {
  rows: Bookings;
  childId?: string;
}) {
  const [t, format] = await Promise.all([
    getTranslations("events"),
    getFormatter(),
  ]);
  return (
    <div className="mt-8 space-y-5">
      {rows.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="min-w-0 rounded-3xl border-2 border-border bg-surface p-5"
            >
              <h2 className="text-h4 wrap-anywhere text-ink">
                {r.event.title}
              </h2>
              <p className="mt-3 text-ink">
                {format.dateTime(r.event.startsAt, "longDateTime")}
              </p>
              <p className="mt-3 font-bold text-ink">
                {t(`registrationStatus.${r.status}`)}
              </p>
              {r.event.status !== "published" ? (
                <p className="text-ink-muted">
                  {t(`status.${r.event.status}`)}
                </p>
              ) : null}
              {r.position ? (
                <p className="text-ink-muted">
                  {t("waitlistPosition", { position: r.position })}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-3">
                <ButtonLink
                  href={slugHref("event", r.event.slug)}
                  variant="quiet"
                >
                  {t("view", { title: r.event.title })}
                </ButtonLink>
                {r.event.status === "published" &&
                (r.status === "registered" || r.status === "waitlisted") ? (
                  <form action={cancel.bind(null, r.id, null, childId)}>
                    <button
                      type="submit"
                      className={buttonStyles({ variant: "secondary" })}
                    >
                      {t("cancelRegistration")}
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">{t("myEmpty")}</p>
      )}
      <ButtonLink href="/events">{t("browse")}</ButtonLink>
    </div>
  );
}
export async function ChildBrowse({
  rows,
  events,
  childId,
}: {
  rows: Bookings;
  events: PublicEvent[];
  childId: string;
}) {
  const t = await getTranslations("events");
  const booked = new Set(
    rows.filter((r) => r.status !== "cancelled").map((r) => r.event.id)
  );
  return (
    <section className="mt-8" aria-labelledby="child-event-list">
      <SectionHeading id="child-event-list" title={t("title")} />
      <p className="mt-4 text-ink-muted">{t("safeguarding")}</p>
      {events.length ? (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="min-w-0 rounded-3xl border-2 border-border bg-surface p-5"
            >
              <h3 className="text-h4 text-ink wrap-anywhere">{event.title}</h3>
              <EventInfo event={event} />
              {!booked.has(event.id) &&
              event.registrationWindow.state === "open" ? (
                <form
                  className="mt-4"
                  action={register.bind(null, event.id, null, childId)}
                >
                  <button type="submit" className={buttonStyles()}>
                    {t("register")}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-ink-muted">{t("empty")}</p>
      )}
    </section>
  );
}
