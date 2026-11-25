import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { ROUTES } from "@/lib/routes";
import { DASHBOARD_CLUBS, DASHBOARD_COMMUNITY } from "@/lib/app-routes";
import { SiteLink } from "@/components/site/site-link";
import { inputStyles, SubmitButton } from "@/components/form";
import {
  ClaimField,
  ClubShell,
  ClubOutcome,
  card,
} from "@/components/clubs/shared";
import { applyClubAction } from "../actions";
export async function generateMetadata() {
  const t = await getTranslations("clubs");
  return { title: t("apply"), robots: { index: false, follow: false } };
}
export default async function Page({
  searchParams,
}: PageProps<"/clubs/apply">) {
  const t = await getTranslations("clubs");
  return (
    <ClubShell title={t("apply")} lead={t("applyIntro")}>
      <Content searchParams={searchParams} />
    </ClubShell>
  );
}
async function Content({
  searchParams,
}: Pick<PageProps<"/clubs/apply">, "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const t = await getTranslations("clubs");
  const options = await as(actor).getClubApplicationOptions();
  return (
    <>
      <SiteLink href={DASHBOARD_CLUBS}>{t("back")}</SiteLink>
      <ClubOutcome query={await searchParams} />
      <p className="text-ink-muted">{t("privacy")}</p>
      {!options.enabled ? (
        <p className={card}>{t("closed")}</p>
      ) : options.institutions.length === 0 ? (
        <div className={card}>
          <p>{t("noOptions")}</p>
          <SiteLink href={DASHBOARD_COMMUNITY}>{t("communityLink")}</SiteLink>
        </div>
      ) : (
        <form
          action={applyClubAction}
          aria-label={t("apply")}
          className={`${card} flex flex-col gap-5`}
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="institution" className="font-semibold">
              {t("institution")}
            </label>
            <select
              id="institution"
              name="institutionId"
              required
              defaultValue=""
              className={`${inputStyles} min-w-0 w-full`}
            >
              <option value="" disabled>
                {t("chooseInstitution")}
              </option>
              {options.institutions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {options.selfAttest ? (
            <ClaimField id="application-affiliation" />
          ) : null}
          <div className="flex flex-col gap-2">
            <label htmlFor="club-name" className="font-semibold">
              {t("name")}
            </label>
            <p id="club-name-hint" className="text-sm text-ink-muted">
              {t("nameHint")}
            </p>
            <input
              id="club-name"
              name="name"
              required
              minLength={3}
              maxLength={80}
              aria-describedby="club-name-hint"
              className={inputStyles}
            />
          </div>
          <SubmitButton pendingLabel={t("working")}>{t("submit")}</SubmitButton>
        </form>
      )}
    </>
  );
}
