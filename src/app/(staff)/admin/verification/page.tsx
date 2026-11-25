import type { Metadata } from "next";
import { getTranslations, getFormatter } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink } from "@/components/site/button-link";
import { as, currentActor } from "@/server/app";
import {
  ADMIN_VERIFICATION,
  adminVerificationEntryPath,
} from "@/lib/app-routes";
import { adminCall } from "../_lib/boundary";
import { AdminDenied } from "../_components/admin-denied";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("entries.verification");
  return { title: t("queueTitle"), robots: { index: false, follow: false } };
}

export default async function Page({
  searchParams,
}: PageProps<"/admin/verification">) {
  const [actor, t, format, query, disciplines] = await Promise.all([
    currentActor(),
    getTranslations("entries.verification"),
    getFormatter(),
    searchParams,
    getTranslations("adminCompetitions.vocabulary.discipline"),
  ]);
  const result = await adminCall(
    () => as(actor).listVerificationQueue({}),
    ADMIN_VERIFICATION
  );
  return (
    <Section width="wide" hue="green" className="pt-10 sm:pt-14">
      <PageHeader title={t("queueTitle")} lead={t("queueLead")} />
      {query.done ? (
        <output className="mt-4 block text-ink">{t("decided")}</output>
      ) : null}
      {!result.ok || !result.value.ok ? (
        <AdminDenied />
      ) : result.value.items.length === 0 ? (
        <p className="mt-6 text-ink">{t("empty")}</p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {result.value.items.map((item) => (
            <li
              key={item.entryId}
              className="rounded-3xl border-2 border-border bg-surface p-5 text-ink"
            >
              <h2 className="text-h4 wrap-anywhere">{item.title}</h2>
              <p className="mt-2 text-sm">
                {item.code} · {item.competition.name} ·{" "}
                {disciplines(item.discipline)}
              </p>
              <p className="mt-2">
                {t(item.route)}
                {item.institutionName ? ` · ${item.institutionName}` : ""}
                {item.ageGroupLabel ? ` · ${item.ageGroupLabel}` : ""}
              </p>
              <p className="mt-2 text-sm">
                {t("arrival", {
                  date: format.dateTime(item.arrivedAt, "longDateTime"),
                })}
              </p>
              {item.resubmitted ? (
                <p className="font-semibold">{t("resubmitted")}</p>
              ) : null}
              <ButtonLink
                href={adminVerificationEntryPath(item.entryId)}
                className="mt-4"
              >
                {t("review", { code: item.code })}
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
