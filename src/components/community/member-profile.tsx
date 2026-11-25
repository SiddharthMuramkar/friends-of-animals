import { getFormatter, getTranslations } from "next-intl/server";
import { memberAction } from "@/app/dashboard/community/actions";
import { inputStyles, SubmitButton } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import { SectionHeading } from "@/components/site/heading";
import type { getMyCommunity } from "@/server/modules/community/membership";

const OUTCOMES = [
  "joined",
  "updated",
  "left",
  "invalid_input",
  "already_member",
  "not_member",
  "child_joins_themselves",
] as const;
const SUCCEEDED = new Set(["joined", "updated", "left"]);
const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

export async function MemberProfile({
  data,
  childId,
  query,
}: {
  data: Awaited<ReturnType<typeof getMyCommunity>>;
  childId?: string;
  query: Record<string, string | string[] | undefined>;
}) {
  const [t, callout, format] = await Promise.all([
    getTranslations("community"),
    getTranslations("common.callout"),
    getFormatter(),
  ]);
  const { member, canManage } = data;
  const active = member?.status === "active";
  const done = OUTCOMES.find((value) => value === query.done);
  const action = active ? "update" : "join";
  const date = (value: Date) =>
    format.dateTime(value, { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  return (
    <section className={CARD} aria-labelledby="profile-heading">
      <SectionHeading id="profile-heading" title={t("profileTitle")} />
      <p className="mt-2 text-ink-muted">{t("privacy")}</p>
      {done ? (
        <div className="mt-4">
          <OutcomeNotice
            key={typeof query.n === "string" ? query.n : done}
            tone={SUCCEEDED.has(done) ? "success" : "danger"}
            label={SUCCEEDED.has(done) ? callout("success") : callout("danger")}
            message={t(`outcome.${done}`)}
          />
        </div>
      ) : null}
      <p className="mt-4 font-bold text-ink">
        {t(`status.${member?.status ?? "none"}`)}
      </p>
      {member ? (
        <dl className="my-4 space-y-2 text-ink">
          <div>
            <dt className="font-semibold">{t("joined")}</dt>
            <dd>
              <time dateTime={member.joinedAt.toISOString()}>
                {date(member.joinedAt)}
              </time>
            </dd>
          </div>
          {member.leftAt ? (
            <div>
              <dt className="font-semibold">{t("left")}</dt>
              <dd>
                <time dateTime={member.leftAt.toISOString()}>
                  {date(member.leftAt)}
                </time>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {canManage ? (
        <>
          <form
            action={memberAction.bind(null, childId ?? null, action)}
            aria-labelledby="profile-heading"
            className="mt-6 flex flex-col gap-5"
          >
            <div className="flex flex-col gap-2">
              <label className="font-semibold text-ink" htmlFor="member-name">
                {t("displayName")}
              </label>
              <p id="member-name-hint" className="text-sm text-ink-muted">
                {t("nameHint")}
              </p>
              <input
                id="member-name"
                name="displayName"
                className={inputStyles}
                required
                minLength={2}
                maxLength={60}
                autoComplete={childId ? "off" : "nickname"}
                aria-describedby="member-name-hint"
                defaultValue={member?.displayName ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="font-semibold text-ink" htmlFor="member-about">
                {t("about")}
              </label>
              <p id="member-about-hint" className="text-sm text-ink-muted">
                {t("aboutHint")}
              </p>
              <textarea
                id="member-about"
                name="about"
                className={inputStyles}
                maxLength={280}
                rows={4}
                aria-describedby="member-about-hint"
                defaultValue={member?.about ?? ""}
              />
            </div>
            <div>
              <SubmitButton pendingLabel={t("working")}>
                {active ? t("update") : member ? t("rejoin") : t("join")}
              </SubmitButton>
            </div>
          </form>
          {active ? (
            <form
              action={memberAction.bind(null, childId ?? null, "leave")}
              aria-labelledby="leave-title"
              className="mt-6 border-t border-border pt-5"
            >
              <h3 id="leave-title" className="font-bold text-ink">
                {t("leave")}
              </h3>
              <p className="my-3 text-ink-muted">{t("leavingNote")}</p>
              <SubmitButton variant="secondary" pendingLabel={t("working")}>
                {t("leave")}
              </SubmitButton>
            </form>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-4 text-ink-muted">{t("childOwnLogin")}</p>
          {member?.displayName ? (
            <p className="mt-2 break-words font-semibold text-ink">
              {member.displayName}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
