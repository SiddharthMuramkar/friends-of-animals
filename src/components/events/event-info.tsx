import { getFormatter, getTranslations } from "next-intl/server";
import { Chip } from "@/components/site/chip";
import type { publicView } from "@/server/modules/events/repository";
export type PublicEvent = ReturnType<typeof publicView>;
export async function EventInfo({
  event,
  detail = false,
}: {
  event: PublicEvent;
  detail?: boolean;
}) {
  const [t, format] = await Promise.all([
    getTranslations("events"),
    getFormatter(),
  ]);
  const date = (at: Date) => format.dateTime(at, "longDateTime");
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip>{t(`kind.${event.kind}`)}</Chip>
        <Chip>
          {event.status === "published"
            ? t(`window.${event.registrationWindow.state}`)
            : t(`status.${event.status}`)}
        </Chip>
      </div>
      <p className="mt-3 text-ink wrap-anywhere">{event.summary}</p>
      <dl className="mt-4 space-y-3 text-ink">
        <div>
          <dt className="font-semibold">{t("date")}</dt>
          <dd>
            <time dateTime={event.startsAt.toISOString()}>
              {date(event.startsAt)}
            </time>
          </dd>
        </div>
        {detail ? (
          <div>
            <dt className="font-semibold">{t("ends")}</dt>
            <dd>
              <time dateTime={event.endsAt.toISOString()}>
                {date(event.endsAt)}
              </time>
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="font-semibold">{t("place")}</dt>
          <dd className="wrap-anywhere">
            {[
              event.venueName,
              detail ? event.address : null,
              event.city,
              detail ? event.pinCode : null,
            ]
              .filter(Boolean)
              .join(", ") ||
              (event.onlineUrl ? t("online") : t("notSpecified"))}
          </dd>
        </div>
        {detail && event.onlineUrl ? (
          <div>
            <dt className="font-semibold">{t("online")}</dt>
            <dd>
              <a
                href={event.onlineUrl}
                rel="noopener noreferrer nofollow"
                className="text-link underline wrap-anywhere"
              >
                {t("onlineLink")}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
      {event.status === "published" ? (
        <>
          <p className="mt-4 font-semibold text-ink">
            {event.placesLeft === null
              ? t("unlimited")
              : t("places", { count: event.placesLeft })}
          </p>
          {event.waitlistEnabled ? (
            <p className="text-ink-muted">{t("waitlistOpen")}</p>
          ) : null}
          <p className="mt-2 text-ink-muted">
            {event.audience === "members" ? t("membersOnly") : t("signedIn")}
          </p>
        </>
      ) : null}
      {detail && event.description ? (
        <p className="mt-5 whitespace-pre-line wrap-anywhere text-ink">
          {event.description}
        </p>
      ) : null}
      {detail && event.registrationWindow.state !== "unavailable" ? (
        <p className="mt-4 text-ink-muted">
          {t("registrationWindow")}: {date(event.registrationWindow.opensAt)} –{" "}
          {date(event.registrationWindow.closesAt)}
        </p>
      ) : null}
    </>
  );
}
