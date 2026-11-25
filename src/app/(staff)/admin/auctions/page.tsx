import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink } from "@/components/site/button-link";
import {
  adminAuctionLotPath,
  ADMIN_AUCTIONS,
  ADMIN_AUCTIONS_NEW,
} from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { AdminDenied } from "../_components/admin-denied";
import { adminCall } from "../_lib/boundary";

export const instant = false;
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auctions.admin");
  return { title: t("title"), robots: { index: false, follow: false } };
}
export default async function Page() {
  const actor = await currentActor();
  const [t, status, loaded] = await Promise.all([
    getTranslations("auctions.admin"),
    getTranslations("auctions.status"),
    adminCall(() => as(actor).listLotsForAdmin(), ADMIN_AUCTIONS),
  ]);
  return (
    <Section hue="yellow" width="wide" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("lead")} />
      {!loaded.ok ? (
        <AdminDenied />
      ) : (
        <>
          <ButtonLink className="mt-5" href={ADMIN_AUCTIONS_NEW}>
            {t("new")}
          </ButtonLink>
          {loaded.value.length === 0 ? (
            <p className="mt-6 text-ink">{t("empty")}</p>
          ) : (
            <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
              {loaded.value.map((lot) => (
                <li
                  key={lot.id}
                  className="rounded-2xl border-2 border-border bg-surface p-5"
                >
                  <h2 className="text-h4 text-ink">{lot.lotCode}</h2>
                  <p className="mt-2 text-ink">{status(lot.status)}</p>
                  <p className="mt-2 text-ink wrap-anywhere">{lot.story}</p>
                  <ButtonLink
                    className="mt-4"
                    href={adminAuctionLotPath(lot.id)}
                    variant="secondary"
                  >
                    {lot.lotCode}
                  </ButtonLink>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}
