import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { buttonStyles } from "@/components/site/button-link";
import { as, currentActor } from "@/server/app";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auctions.purchase");
  return { title: t("title"), robots: { index: false, follow: false } };
}
export default async function Page() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect("/sign-in?next=%2Faccount%2Fauctions");
  const [t, offers] = await Promise.all([
    getTranslations("auctions.purchase"),
    as(actor).listMyAuctionOffers(),
  ]);
  return (
    <Section hue="yellow" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("lead")} />
      {offers.length === 0 ? (
        <p className="mt-5 text-ink">{t("noOffers")}</p>
      ) : (
        <ul className="mt-5 space-y-4">
          {offers.map((offer) => (
            <li
              key={offer.id}
              className="rounded-3xl border-2 border-border bg-surface p-5 space-y-3"
            >
              <h2 className="text-h3 text-ink">{offer.lotCode}</h2>
              <p>
                {formatPaise(offer.amountPaise)} ·{" "}
                {offer.deliveryStatus
                  ? t(`statuses.${offer.deliveryStatus}`)
                  : t("offerLead")}
              </p>
              <a
                href={`/account/auctions/${offer.lotCode}`}
                className={buttonStyles({ variant: "secondary" })}
              >
                {t("openPurchase", { lotCode: offer.lotCode })}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
