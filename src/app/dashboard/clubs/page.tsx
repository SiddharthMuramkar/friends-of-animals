import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { ROUTES } from "@/lib/routes";
import { CLUB_APPLY, clubPath, DASHBOARD_TIMELINE } from "@/lib/app-routes";
import { SiteLink } from "@/components/site/site-link";
import { ButtonLink } from "@/components/site/button-link";
import { SectionHeading } from "@/components/site/heading";
import { ClubShell, card } from "@/components/clubs/shared";
export async function generateMetadata() {
  const t = await getTranslations("clubs");
  return { title: t("title"), robots: { index: false, follow: false } };
}
export default async function Page() {
  const t = await getTranslations("clubs");
  return (
    <ClubShell title={t("title")} lead={t("intro")}>
      <Content />
    </ClubShell>
  );
}
async function Content() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const data = await as(actor).listMyClubs();
  const t = await getTranslations("clubs");
  return (
    <>
      <p className="text-ink-muted">{t("privacy")}</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href={CLUB_APPLY}>{t("apply")}</ButtonLink>
        <SiteLink href={DASHBOARD_TIMELINE}>{t("timeline")}</SiteLink>
      </div>
      {!data.enabled ? <p>{t("closed")}</p> : null}
      {(
        [
          ["yourClubs", data.clubs],
          ["available", data.available],
        ] as const
      ).map(([key, rows]) => (
        <section key={key} aria-labelledby={`club-${key}`} className={card}>
          <SectionHeading id={`club-${key}`} title={t(key)} />
          {rows.length === 0 ? (
            <p className="mt-3 text-ink-muted">{t("empty")}</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {rows.map((c) => (
                <li
                  key={c.id}
                  className="min-w-0 break-words border-b border-border pb-3"
                >
                  <SiteLink className="font-bold" href={clubPath(c.id)}>
                    {c.name}
                  </SiteLink>
                  <p>
                    {c.institutionName} · {t(`status.${c.status}`)} ·{" "}
                    {t("count", { count: c.memberCount })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
