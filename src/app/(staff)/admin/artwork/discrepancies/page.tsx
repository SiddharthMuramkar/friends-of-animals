import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink } from "@/components/site/button-link";
import {
  ADMIN_ARTWORK,
  ADMIN_ARTWORK_DISCREPANCIES,
  adminArtworkPath,
} from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { AdminDenied } from "../../_components/admin-denied";
import { adminCall } from "../../_lib/boundary";

export const instant = false;
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("artworkCustody");
  return {
    title: t("discrepancyTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const [t, format, actor] = await Promise.all([
    getTranslations("artworkCustody"),
    getFormatter(),
    currentActor(),
  ]);
  const result = await adminCall(
    () => as(actor).listArtworkDiscrepancies({}),
    ADMIN_ARTWORK_DISCREPANCIES
  );
  return (
    <Section width="wide" hue="green" className="pt-10 sm:pt-14">
      <PageHeader title={t("discrepancyTitle")} lead={t("discrepancyLead")} />
      <ButtonLink variant="secondary" className="mt-4" href={ADMIN_ARTWORK}>
        {t("back")}
      </ButtonLink>
      {result.ok && result.value.ok ? (
        result.value.discrepancies.length ? (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {result.value.discrepancies.map((row) => (
              <li
                key={row.discrepancy.id}
                className="rounded-3xl border-2 border-border bg-surface p-5"
              >
                <h2 className="text-h4">
                  <a
                    className="underline text-link"
                    href={adminArtworkPath(row.artworkCode)}
                  >
                    {row.artworkCode}
                  </a>
                </h2>
                <p>
                  {row.entryCode} ·{" "}
                  <time dateTime={row.discrepancy.raisedAt.toISOString()}>
                    {format.dateTime(row.discrepancy.raisedAt, "longDateTime")}
                  </time>
                </p>
                <p className="mt-3 whitespace-pre-wrap wrap-anywhere">
                  {row.discrepancy.notes}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6">{t("noDiscrepancies")}</p>
        )
      ) : (
        <AdminDenied />
      )}
    </Section>
  );
}
