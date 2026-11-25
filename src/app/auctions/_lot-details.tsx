import { getFormatter, getTranslations } from "next-intl/server";
import type { PublicLot } from "@/server/modules/auctions/read";

export function formatPaise(value: bigint): string {
  return (
    "₹" +
    (value / 100n).toLocaleString("en-IN") +
    "." +
    String(value % 100n).padStart(2, "0")
  );
}
export async function LotDetails({ lot }: { lot: PublicLot }) {
  const [t, format] = await Promise.all([
    getTranslations("auctions"),
    getFormatter(),
  ]);
  const when = (date: Date) =>
    format.dateTime(date, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    });
  return (
    <>
      <p className="mt-2 font-semibold text-ink-muted">
        {t(`status.${lot.status}`)}
      </p>
      <p className="mt-3 text-ink">
        {t("credit", { name: lot.creatorCredit })}
      </p>
      <p className="mt-4 text-ink whitespace-pre-wrap wrap-anywhere">
        {lot.story}
      </p>
      <dl className="mt-5 grid gap-3 text-ink">
        <div>
          <dt className="text-sm font-semibold">{t("base")}</dt>
          <dd>{formatPaise(lot.basePricePaise)}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">{t("highest")}</dt>
          <dd>
            <output aria-live="polite">
              {lot.currentBidPaise === null
                ? t("noBids")
                : formatPaise(lot.currentBidPaise)}
            </output>
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">{t("opens")}</dt>
          <dd>
            <time dateTime={lot.opensAt.toISOString()}>
              {when(lot.opensAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">{t("closes")}</dt>
          <dd>
            <output aria-live="polite">
              <time dateTime={lot.closesAt.toISOString()}>
                {when(lot.closesAt)}
              </time>
            </output>
          </dd>
        </div>
        {lot.award ? (
          <div>
            <dt className="text-sm font-semibold">{t("award")}</dt>
            <dd>{lot.award}</dd>
          </div>
        ) : null}
      </dl>
    </>
  );
}
