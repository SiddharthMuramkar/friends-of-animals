import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { inputStyles } from "@/components/form/text-field";
import { Feedback } from "@/components/events/feedback";
import {
  adminEventPath,
  eventRegistrationsPath,
  eventCheckInPath,
} from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { adminCall } from "../../../_lib/boundary";
import { AdminDenied } from "../../../_components/admin-denied";
import { checkIn } from "../../actions";
export async function generateMetadata() {
  const t = await getTranslations("events");
  return { title: t("sheet"), robots: { index: false, follow: false } };
}
export default async function Page(
  props: PageProps<"/admin/events/[id]/check-in">
) {
  const t = await getTranslations("events");
  return (
    <Section hue="green" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader title={t("sheet")} lead={t("sheetLead")} />
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
}: PageProps<"/admin/events/[id]/check-in">) {
  const [{ id: eventId }, actor, t, query] = await Promise.all([
    params,
    currentActor(),
    getTranslations("events"),
    searchParams,
  ]);
  const q = typeof query.q === "string" ? query.q.slice(0, 120) : "";
  const api = as(actor);
  const loaded = await adminCall(
    () =>
      Promise.all([
        api.getEventForAdmin({ eventId }),
        api.getCheckInSheet({ eventId, query: q }),
      ]),
    eventCheckInPath(eventId)
  );
  if (!loaded.ok) return <AdminDenied />;
  const [details, list] = loaded.value;
  if (!details.ok || !list.ok) notFound();
  return (
    <div className="mt-8 flex flex-col gap-5">
      <h2 className="text-h3 text-ink wrap-anywhere">{details.event.title}</h2>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href={adminEventPath(eventId)} variant="quiet">
          {t("edit")}
        </ButtonLink>
        <ButtonLink href={eventRegistrationsPath(eventId)} variant="secondary">
          {t("registrations")}
        </ButtonLink>
      </div>
      <div className="flex flex-wrap gap-4 text-ink">
        <p className="font-semibold">
          {t("registeredCount", { count: list.registered })}
        </p>
        <p className="font-semibold">
          {t("checkedInCount", { count: list.checkedIn })}
        </p>
      </div>
      {!list.open ? (
        <p className="text-ink-muted">{t("checkInClosed")}</p>
      ) : null}
      <form
        action={eventCheckInPath(eventId)}
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded-3xl border border-border bg-surface p-5"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="attendee-search" className="font-semibold text-ink">
            {t("search")}
          </label>
          <input
            className={inputStyles}
            id="attendee-search"
            name="q"
            type="search"
            maxLength={120}
            defaultValue={q}
          />
        </div>
        <button
          type="submit"
          className={buttonStyles({ variant: "secondary" })}
        >
          {t("apply")}
        </button>
      </form>
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
              {list.open && r.status === "registered" ? (
                <form
                  className="mt-4"
                  action={checkIn.bind(null, eventId, r.id)}
                >
                  <button type="submit" className={buttonStyles()}>
                    {t("checkIn")}
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
