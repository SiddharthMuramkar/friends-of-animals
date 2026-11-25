import type { Metadata } from "next";
import { getTranslations, getFormatter } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Checkout } from "@/components/payments/checkout";
import { checkoutLabels } from "@/components/payments/checkout-labels";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { inputStyles } from "@/components/form";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { as, currentActor } from "@/server/app";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { INDIAN_STATES } from "@/server/modules/auctions/domain/delivery-address";
import { parseLotCode } from "@/server/modules/auctions/domain/lot-code";
import {
  startAuctionCheckout,
  confirmAuctionCheckout,
  answerAuctionCheckout,
  saveAuctionAddress,
  confirmAuctionReceipt,
} from "./actions";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auctions.purchase");
  return { title: t("title"), robots: { index: false, follow: false } };
}
const card =
  "mt-6 space-y-4 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6";
export default async function Page({
  params,
  searchParams,
}: PageProps<"/account/auctions/[lotCode]">) {
  const { lotCode: raw } = await params;
  const code = parseLotCode(raw);
  const actor = await currentActor();
  if (actor.kind !== "user")
    redirect(
      `/sign-in?next=${encodeURIComponent(code ? `/account/auctions/${code}` : "/account/auctions")}`
    );
  const [t, format, requestHeaders, query, offer] = await Promise.all([
    getTranslations("auctions.purchase"),
    getFormatter(),
    headers(),
    searchParams,
    code ? as(actor).getMyAuctionOffer({ lotCode: code }) : null,
  ]);
  const amount = offer ? formatPaise(offer.amountPaise) : "";
  const labels = await checkoutLabels({
    submit: t("pay", { amount }),
    submitting: t("paying"),
    confirming: t("confirming"),
  });
  return (
    <Section hue="yellow" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <ButtonLink href="/account/auctions" variant="quiet">
        {t("back")}
      </ButtonLink>
      <PageHeader
        className="mt-5"
        title={offer ? t("offerTitle", { lotCode: offer.lotCode }) : t("title")}
      />
      {!offer ? (
        <p className="mt-6 text-ink">{t("unavailable")}</p>
      ) : (
        <>
          {query.result ? (
            <output className="mt-4 block text-ink">
              {t(query.result === "ok" ? "saved" : "error")}
            </output>
          ) : null}
          <section className={card} aria-labelledby="purchase-title">
            <h2 id="purchase-title" className="text-h3 text-ink">
              {offer.status === "paid" ? t("paid") : t("offerLead")}
            </h2>
            <dl className="text-ink">
              <dt>{t("amount")}</dt>
              <dd className="font-bold text-h3">{amount}</dd>
              {offer.status === "open" ? (
                <>
                  <dt className="mt-3">{t("deadline")}</dt>
                  <dd>
                    {format.dateTime(offer.expiresAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Kolkata",
                    })}
                  </dd>
                </>
              ) : null}
            </dl>
            {offer.status === "open" ? (
              offer.batchStatus === "needs_review" ? (
                <p>{t("review")}</p>
              ) : (
                <Checkout
                  start={startAuctionCheckout.bind(null, offer.id)}
                  confirm={confirmAuctionCheckout.bind(
                    null,
                    offer.lotCode,
                    offer.id
                  )}
                  answerTestCheckout={answerAuctionCheckout.bind(
                    null,
                    offer.id
                  )}
                  nonce={requestHeaders.get("x-nonce")}
                  labels={labels}
                />
              )
            ) : null}
          </section>
          {offer.deliveryStatus ? (
            <section className={card} aria-labelledby="delivery-title">
              <h2 id="delivery-title" className="text-h3 text-ink">
                {t("delivery")}
              </h2>
              <p className="font-semibold text-ink">
                {t(`statuses.${offer.deliveryStatus}`)}
              </p>
              {offer.courier ? (
                <p>
                  {t("courier")}: {offer.courier}
                </p>
              ) : null}
              {offer.trackingNumber ? (
                <p className="wrap-anywhere">
                  {t("trackingNumber")}: {offer.trackingNumber}
                </p>
              ) : null}
              {["awaiting_address", "pending_dispatch"].includes(
                offer.deliveryStatus
              ) ? (
                <form
                  action={saveAuctionAddress.bind(
                    null,
                    offer.lotCode,
                    offer.id
                  )}
                  className="space-y-4"
                  aria-labelledby="address-title"
                >
                  <h3 id="address-title" className="font-semibold text-ink">
                    {t("addressTitle")}
                  </h3>
                  <p className="text-sm text-ink-muted">{t("addressHint")}</p>
                  {(
                    [
                      ["recipientName", "shipping name", 100],
                      ["line1", "shipping address-line1", 200],
                      ["line2", "shipping address-line2", 200],
                      ["city", "shipping address-level2", 100],
                      ["pincode", "shipping postal-code", 6],
                    ] as const
                  ).map(([name, autocomplete, max]) => (
                    <div key={name}>
                      <label
                        htmlFor={name}
                        className="mb-1 block font-semibold text-ink"
                      >
                        {t(name)}
                      </label>
                      <input
                        id={name}
                        name={name}
                        className={inputStyles}
                        autoComplete={autocomplete}
                        defaultValue={offer.address?.[name] ?? ""}
                        required={name !== "line2"}
                        maxLength={max}
                        {...(name === "pincode"
                          ? {
                              inputMode: "numeric" as const,
                              pattern: "[1-9][0-9]{5}",
                            }
                          : {})}
                      />
                    </div>
                  ))}
                  <div>
                    <label
                      htmlFor="state"
                      className="mb-1 block font-semibold text-ink"
                    >
                      {t("state")}
                    </label>
                    <select
                      className={inputStyles}
                      id="state"
                      name="state"
                      autoComplete="shipping address-level1"
                      defaultValue={offer.address?.state ?? ""}
                      required
                    >
                      <option value="">—</option>
                      {INDIAN_STATES.map((state) => (
                        <option key={state}>{state}</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className={buttonStyles()}>
                    {t("saveAddress")}
                  </button>
                </form>
              ) : null}
              {["dispatched", "delivered"].includes(offer.deliveryStatus) ? (
                <form
                  action={confirmAuctionReceipt.bind(
                    null,
                    offer.lotCode,
                    offer.id
                  )}
                >
                  <button type="submit" className={buttonStyles()}>
                    {t("confirmReceipt")}
                  </button>
                </form>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </Section>
  );
}
