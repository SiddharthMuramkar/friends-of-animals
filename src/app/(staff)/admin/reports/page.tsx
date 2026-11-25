import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ADMIN_REPORTS, adminCompetitionReportPath } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { AdminDenied } from "../_components/admin-denied";
import { adminCall } from "../_lib/boundary";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminReports");
  return { title: t("title"), robots: { index: false, follow: false } };
}
export default async function Page() {
  const [t, actor] = await Promise.all([
    getTranslations("adminReports"),
    currentActor(),
  ]);
  const call = await adminCall(
    () => as(actor).listReportCompetitions(),
    ADMIN_REPORTS
  );
  return (
    <Section width="wide" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("lead")} />
      {!call.ok ? (
        <AdminDenied />
      ) : !call.value.length ? (
        <p className="mt-6">{t("empty")}</p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {call.value.map((comp) => (
            <li key={comp.id} className="min-w-0">
              <SiteLink
                href={adminCompetitionReportPath(comp.code)}
                prefetch={false}
                className="flex h-full flex-col gap-2 rounded-2xl border-2 border-border bg-surface p-5 font-semibold text-link hover:border-ink"
              >
                <span className="wrap-anywhere">{comp.name}</span>
                <span className="font-normal text-ink-muted">{comp.code}</span>
              </SiteLink>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
