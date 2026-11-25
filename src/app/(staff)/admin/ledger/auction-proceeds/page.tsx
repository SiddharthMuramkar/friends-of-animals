import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ADMIN_AUCTION_PROCEEDS, ADMIN_LEDGER } from "@/lib/app-routes";
import { inputStyles } from "@/components/form";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { as, currentActor } from "@/server/app";
import { creatorSharePercentForInput } from "@/server/modules/auctions/domain/proceeds";
import { adminCall } from "../../_lib/boundary";
import { AdminDenied } from "../../_components/admin-denied";
import { savePolicy } from "./actions";
export const instant = false;
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auctions.purchase");
  return { title: t("proceedsTitle"), robots: { index: false, follow: false } };
}
export default async function Page({
  searchParams,
}: PageProps<"/admin/ledger/auction-proceeds">) {
  const actor = await currentActor();
  const [t, query, loaded] = await Promise.all([
    getTranslations("auctions.purchase"),
    searchParams,
    adminCall(
      () => as(actor).listAuctionProceedsPolicies(),
      ADMIN_AUCTION_PROCEEDS
    ),
  ]);
  return (
    <Section hue="green" width="prose" className="pt-10 sm:pt-14">
      <ButtonLink href={ADMIN_LEDGER} variant="quiet">
        {(await getTranslations("adminLedger.list"))("title")}
      </ButtonLink>
      <PageHeader
        className="mt-4"
        title={t("proceedsTitle")}
        lead={t("proceedsLead")}
      />
      {!loaded.ok ? (
        <AdminDenied />
      ) : (
        <>
          {query.result ? (
            <output className="mt-4 block">
              {t(query.result === "ok" ? "saved" : "error")}
            </output>
          ) : null}
          {loaded.value.length === 0 ? (
            <p>{t("noPolicies")}</p>
          ) : (
            <ul className="mt-6 space-y-5">
              {loaded.value.map((policy) => (
                <li
                  className="rounded-3xl border-2 border-border bg-surface p-5"
                  key={policy.competitionId}
                >
                  <form
                    action={savePolicy.bind(null, policy.competitionId)}
                    className="space-y-3"
                    aria-labelledby={`policy-${policy.competitionId}`}
                  >
                    <h2
                      id={`policy-${policy.competitionId}`}
                      className="text-h3 text-ink"
                    >
                      {policy.name}
                    </h2>
                    <label
                      htmlFor={`share-${policy.competitionId}`}
                      className="block font-semibold"
                    >
                      {t("share")}
                    </label>
                    <p
                      id={`hint-${policy.competitionId}`}
                      className="text-ink-muted text-sm"
                    >
                      {t("shareHint")}
                    </p>
                    <input
                      id={`share-${policy.competitionId}`}
                      name="share"
                      className={inputStyles}
                      inputMode="decimal"
                      required
                      pattern="[0-9]{1,3}([.][0-9]{1,2})?"
                      maxLength={6}
                      defaultValue={creatorSharePercentForInput(
                        policy.creatorShareBps
                      )}
                      aria-describedby={`hint-${policy.competitionId}`}
                    />
                    <button type="submit" className={buttonStyles()}>
                      {t("savePolicy")}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}
