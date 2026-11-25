import { getTranslations, getFormatter } from "next-intl/server";
import type { ArtworkView } from "@/server/modules/physical-artwork";
export async function ArtworkFacts({ work }: { work: ArtworkView }) {
  const [t, format] = await Promise.all([
    getTranslations("artwork"),
    getFormatter(),
  ]);
  return (
    <div className="mt-3 space-y-2 text-ink">
      <p className="font-semibold">{t(`status.${work.status}`)}</p>
      {work.overdue ? <p className="font-semibold">{t("overdue")}</p> : null}
      <dl className="space-y-2">
        <div>
          <dt className="font-semibold">{t("entry")}</dt>
          <dd>
            {work.entryCode} · {work.entryTitle}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t("packaging")}</dt>
          <dd className="whitespace-pre-wrap wrap-anywhere">
            {work.packagingInstructions}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t("shipping")}</dt>
          <dd>{t(work.shippingPayer === "foa" ? "foa" : "sender")}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t("address")}</dt>
          <dd className="whitespace-pre-wrap wrap-anywhere">
            {work.facilityAddress}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t("deadline")}</dt>
          <dd>{format.dateTime(work.dispatchDeadline, "longDateTime")}</dd>
        </div>
        {work.courierName ? (
          <div>
            <dt className="font-semibold">{t("courier")}</dt>
            <dd>{work.courierName}</dd>
          </div>
        ) : null}
        {work.trackingNumber ? (
          <div>
            <dt className="font-semibold">{t("tracking")}</dt>
            <dd className="wrap-anywhere">{work.trackingNumber}</dd>
          </div>
        ) : null}
      </dl>
      {work.dispatchedLate ? <p>{t("late")}</p> : null}
      {work.receivedWithoutDispatch ? <p>{t("withoutDispatch")}</p> : null}
      {work.receivedAt ? (
        <p>
          {t("receivedOn", {
            date: format.dateTime(work.receivedAt, "longDateTime"),
          })}
        </p>
      ) : null}
    </div>
  );
}
