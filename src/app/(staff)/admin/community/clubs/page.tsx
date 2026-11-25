import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { ROUTES } from "@/lib/routes";
import { ADMIN_CLUBS, adminClubPath } from "@/lib/app-routes";
import { SiteLink } from "@/components/site/site-link";
import { ClubShell, card } from "@/components/clubs/shared";
import { adminCall } from "../../_lib/boundary";
import { AdminDenied } from "../../_components/admin-denied";
export async function generateMetadata() {
  const t = await getTranslations("clubs");
  return { title: t("adminTitle"), robots: { index: false, follow: false } };
}
export default async function Page() {
  const t = await getTranslations("clubs");
  return (
    <ClubShell title={t("adminTitle")} lead={t("adminIntro")}>
      <Content />
    </ClubShell>
  );
}
async function Content() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const loaded = await adminCall(
    () => as(actor).listClubsForReview(),
    ADMIN_CLUBS
  );
  if (!loaded.ok) return <AdminDenied />;
  const t = await getTranslations("clubs");
  return loaded.value.clubs.length === 0 ? (
    <p>{t("empty")}</p>
  ) : (
    <ul className="space-y-4">
      {loaded.value.clubs.map((c) => (
        <li key={c.id} className={card}>
          <SiteLink href={adminClubPath(c.id)} className="font-bold text-lead">
            {c.name}
          </SiteLink>
          <p>
            {c.institutionName} · {t(`status.${c.status}`)}
          </p>
          <p>
            {c.applicantName
              ? t("applicant", { name: c.applicantName })
              : t("removed")}{" "}
            · {t(`affiliation.${c.applicantKind}`)} ·{" "}
            {t(c.applicantVerified ? "verified" : "selfAttested")}
          </p>
          <p>{t("count", { count: c.memberCount })}</p>
        </li>
      ))}
    </ul>
  );
}
