import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import type { ReceiptSnapshot } from "@/server/modules/donations";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

/**
 * A donation's receipt as issued (#106), from its frozen snapshot: what
 * the screen shows and what prints on one A4 page. A fact FOA hadn't
 * confirmed when it was issued prints "To be confirmed". No 80G section
 * while FOA has no 80G (HR-16); the layout waits on the accountant (HR-47).
 */
export async function ReceiptSheet({
  snapshot,
  cancelled,
}: {
  snapshot: ReceiptSnapshot;
  cancelled: boolean;
}) {
  const [t, format] = await Promise.all([
    getTranslations("receipts.sheet"),
    getFormatter(),
  ]);
  const fact = (value: string | null) => value ?? t("toBeConfirmed");
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[12rem_minmax(0,1fr)] print:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="font-semibold text-ink">{label}</dt>
      <dd className="wrap-anywhere text-ink">{value}</dd>
    </div>
  );
  return (
    <article
      aria-labelledby="receipt-title"
      className="rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8 print:rounded-none print:border-0 print:p-0 print:shadow-none"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b-2 border-border pb-4">
        <div>
          <p className="text-lead font-semibold text-ink">
            {snapshot.org.legalName ?? snapshot.org.name}
          </p>
          <h1 id="receipt-title" className="mt-1 text-h3">
            {t("title")}
          </h1>
        </div>
        <p className="font-semibold text-ink">{snapshot.number}</p>
      </header>
      {cancelled ? (
        <p className="mt-4 rounded-2xl border-2 border-danger p-4 font-semibold text-danger">
          {t("cancelled")}
        </p>
      ) : null}
      <dl className="mt-4 divide-y divide-border">
        {row(t("number"), snapshot.number)}
        {row(
          t("issued"),
          format.dateTime(new Date(snapshot.issuedAt), { dateStyle: "long" })
        )}
        {row(t("receivedFrom"), snapshot.donor.name)}
        {snapshot.donor.organisationName
          ? row(t("organisation"), snapshot.donor.organisationName)
          : null}
        {row(t("amount"), formatPaise(BigInt(snapshot.amount.minor)))}
        {row(t("inWords"), snapshot.amount.inWords)}
        {row(t("mode"), t("online"))}
        {row(t("reference"), snapshot.payment.reference)}
      </dl>
      <h2 className="mt-6 text-h4">{t("issuer")}</h2>
      <dl className="mt-2 divide-y divide-border">
        {row(t("issuer"), fact(snapshot.org.legalName))}
        {row(t("registration"), fact(snapshot.org.registration.type))}
        {row(t("registrationNumber"), fact(snapshot.org.registration.number))}
        {row(t("pan"), fact(snapshot.org.registration.pan))}
        {row(t("address"), fact(snapshot.org.address))}
      </dl>
      <p className="mt-6 text-ink">{t("noGoods")}</p>
      <p className="mt-2 text-ink-muted">{t("noTax")}</p>
    </article>
  );
}
