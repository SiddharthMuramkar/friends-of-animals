import { getTranslations } from "next-intl/server";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { inputStyles } from "@/components/form";
import { auctionLotPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import type { PublicLot } from "@/server/modules/auctions/read";
import { MAX_PAISE } from "@/server/modules/competitions/domain/fees";
import { BID_DECLARATION_VERSION } from "@/server/modules/auctions/domain/bid-declaration";
import { formatPaise } from "./_lot-details";
import { bidOnLot } from "./_lib/bid-action";

export async function BidForm({
  lot,
  signedIn,
  result,
}: {
  lot: PublicLot;
  signedIn: boolean;
  result: string | string[] | undefined;
}) {
  const t = await getTranslations("auctions.bidding");
  if (lot.status !== "open") return null;
  const minimum = formatPaise(lot.minimumBidPaise);
  const response =
    result === "accepted"
      ? t("accepted")
      : result === "bid_below_base" || result === "bid_too_low"
        ? t("tooLow", { minimum })
        : result === "minor"
          ? t("minor")
          : result === "declaration_required"
            ? t("declarationRequired")
            : result === "invalid_amount" || result === "invalid_input"
              ? t("invalidAmount")
              : result === "bidder_unavailable"
                ? t("bidderUnavailable")
                : result === "lot_not_open"
                  ? t("notOpen")
                  : null;
  return (
    <section
      className="mt-6 border-t-2 border-border pt-5"
      aria-labelledby="bid-heading"
    >
      <h3 id="bid-heading" className="text-h4 text-ink">
        {t("heading")}
      </h3>
      <p className="mt-2 text-ink">{t("minimum", { minimum })}</p>
      <p className="mt-2 text-sm text-ink-muted">{t("lateBid")}</p>
      {response ? (
        <p
          role={result === "accepted" ? "status" : "alert"}
          className="my-3 font-semibold text-ink"
        >
          {response}
        </p>
      ) : null}
      {lot.minimumBidPaise > MAX_PAISE ? (
        <p className="mt-4 text-ink">{t("limit")}</p>
      ) : signedIn ? (
        <form
          action={bidOnLot.bind(null, lot.lotCode)}
          className="mt-4 space-y-4"
          aria-labelledby="bid-heading"
        >
          <input
            type="hidden"
            name="declarationVersion"
            value={BID_DECLARATION_VERSION}
          />
          <div className="space-y-2">
            <label
              htmlFor="bid-amount"
              className="block font-semibold text-ink"
            >
              {t("amount")}
            </label>
            <p id="bid-amount-hint" className="text-sm text-ink-muted">
              {t("amountHint")}
            </p>
            <input
              className={inputStyles}
              id="bid-amount"
              type="text"
              inputMode="decimal"
              pattern="[0-9]{1,17}(\.[0-9]{1,2})?"
              name="amount"
              required
              maxLength={20}
              aria-describedby="bid-amount-hint"
            />
          </div>
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-5 accent-current"
              id="bid-adult"
              name="adult"
              required
            />
            <label htmlFor="bid-adult" className="text-ink">
              {t("declaration")}
            </label>
          </div>
          <button type="submit" className={buttonStyles()}>
            {t("submit")}
          </button>
        </form>
      ) : (
        <>
          <p className="mt-4 text-ink">{t("adultOnly")}</p>
          <ButtonLink
            className="mt-3"
            href={`${ROUTES.signIn.path}?next=${encodeURIComponent(auctionLotPath(lot.lotCode))}`}
          >
            {t("signIn")}
          </ButtonLink>
        </>
      )}
    </section>
  );
}
