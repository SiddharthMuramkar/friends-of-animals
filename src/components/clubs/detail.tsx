import { getFormatter, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import { ROUTES } from "@/lib/routes";
import { ADMIN_CLUBS, DASHBOARD_CLUBS } from "@/lib/app-routes";
import { SiteLink } from "@/components/site/site-link";
import { SectionHeading } from "@/components/site/heading";
import { SubmitButton, inputStyles } from "@/components/form";
import { clubAction } from "@/app/clubs/actions";
import { card, ClaimField, ClubOutcome } from "./shared";
import type { ClubAction } from "@/server/modules/clubs/domain/status";
export async function ClubDetail({
  clubId,
  admin,
  query,
}: {
  clubId: string;
  admin: boolean;
  query: Record<string, string | string[] | undefined>;
}) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const api = as(actor);
  const data = await api.getClub({ clubId }).catch((error) => {
    if (error instanceof DomainError) notFound();
    throw new Error(`Club read failed: ${errorSummaryForLogs(error)}`);
  });
  if (admin && !data.canReview) notFound();
  const t = await getTranslations("clubs");
  const format = await getFormatter();
  const date = (value: Date) =>
    format.dateTime(value, { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  const status = data.club.status;
  const actions: ClubAction[] =
    status === "applied"
      ? ["approve", "decline"]
      : status === "approved"
        ? ["suspend", "close"]
        : status === "suspended"
          ? ["approve", "close"]
          : [];
  const notice = await ClubOutcome({ query });
  const details = data.canReadRoster
    ? await Promise.all([
        api.listClubMembers({ clubId }),
        api.getClubActivity({ clubId }),
      ])
    : null;
  return (
    <>
      <SiteLink href={admin ? ADMIN_CLUBS : DASHBOARD_CLUBS}>
        {t("back")}
      </SiteLink>
      {notice}
      <section className={card} aria-labelledby="club-name">
        <SectionHeading id="club-name" title={data.club.name} />
        <p>{data.club.institutionName}</p>
        <p className="font-bold">{t(`status.${status}`)}</p>
        <p>{t("count", { count: data.club.memberCount })}</p>
        {data.applicant ? (
          <p>
            {t(`affiliation.${data.applicant.kind}`)} ·{" "}
            {t(data.applicant.verified ? "verified" : "selfAttested")}
          </p>
        ) : null}
        <p className="mt-3 text-ink-muted">{t("privacy")}</p>
        {!admin && data.joined ? (
          <p className="mt-4 font-bold">{t("joined")}</p>
        ) : null}
        {!admin && data.joined ? (
          <form
            action={clubAction.bind(null, clubId, "leave")}
            aria-label={t("leave")}
            className="mt-4"
          >
            <SubmitButton pendingLabel={t("working")} variant="secondary">
              {t("leave")}
            </SubmitButton>
          </form>
        ) : null}
        {!admin && data.canJoin ? (
          <form
            action={clubAction.bind(null, clubId, "join")}
            aria-label={t("join")}
            className="mt-4 flex flex-col gap-4"
          >
            {data.verifiedRole ? null : <ClaimField id="join-affiliation" />}
            <SubmitButton pendingLabel={t("working")}>{t("join")}</SubmitButton>
          </form>
        ) : null}
        {!admin && data.own && status === "applied" ? (
          <form
            action={clubAction.bind(null, clubId, "withdraw")}
            aria-label={t("withdraw")}
            className="mt-4"
          >
            <SubmitButton pendingLabel={t("working")} variant="secondary">
              {t("withdraw")}
            </SubmitButton>
          </form>
        ) : null}
      </section>
      {admin && actions.length ? (
        <section className={card} aria-labelledby="club-decisions">
          <SectionHeading id="club-decisions" title={t("decisionActions")} />
          <p className="mt-2 text-ink-muted">{t("decisionHint")}</p>
          {actions.map((action) => {
            if (action === "withdraw") return null;
            const label = t(
              `actions.${action === "approve" && status === "suspended" ? "reinstate" : action}`
            );
            return (
              <form
                key={action}
                action={clubAction.bind(null, clubId, action)}
                aria-label={label}
                className="mt-4 flex flex-col gap-2 border-t border-border pt-4"
              >
                <label htmlFor={`reason-${action}`} className="font-semibold">
                  {t("decisionNote")} — {label}
                </label>
                <textarea
                  id={`reason-${action}`}
                  name="reason"
                  maxLength={1000}
                  required={action !== "approve"}
                  className={`${inputStyles} min-h-24 w-full`}
                />
                <SubmitButton pendingLabel={t("working")}>{label}</SubmitButton>
              </form>
            );
          })}
        </section>
      ) : null}
      {data.decisions.length ? (
        <section className={card} aria-labelledby="decision-history">
          <SectionHeading id="decision-history" title={t("decisions")} />
          <ul className="mt-4 space-y-3">
            {data.decisions.map((d) => (
              <li key={d.id}>
                <p>
                  {date(d.at)} ·{" "}
                  {t(
                    `activityKind.${d.from === "suspended" && d.to === "approved" ? "reinstated" : d.to}`
                  )}
                </p>
                {d.reason ? (
                  <p className="whitespace-pre-wrap break-words">{d.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {details ? (
        <>
          <section className={card} aria-labelledby="club-roster">
            <SectionHeading id="club-roster" title={t("roster")} />
            {details[0].members.length ? (
              <ul className="mt-4 space-y-3">
                {details[0].members.map((m) => (
                  <li key={m.id} className="border-b border-border pb-2">
                    <p className="font-bold">{m.displayName}</p>
                    <p>
                      {t(`affiliation.${m.role}`)} ·{" "}
                      {t(m.affiliationVerified ? "verified" : "selfAttested")}
                    </p>
                    <p>
                      {t("memberJoined", { date: date(m.joinedAt) })}
                      {m.leftAt
                        ? ` · ${t("memberLeft", { date: date(m.leftAt) })}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("empty")}</p>
            )}
          </section>
          <section className={card} aria-labelledby="club-activity">
            <SectionHeading id="club-activity" title={t("activity")} />
            <ol className="mt-4 space-y-3">
              {details[1].activity.map((a) => (
                <li key={a.id}>
                  <time dateTime={a.at.toISOString()}>{date(a.at)}</time> ·{" "}
                  {t(`activityKind.${a.kind}`)}
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </>
  );
}
