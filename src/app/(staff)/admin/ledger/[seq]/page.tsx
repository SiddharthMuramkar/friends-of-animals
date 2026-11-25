import { getFormatter, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { adminLedgerPostingPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { as, currentActor } from "@/server/app";
import {
  istDateOf,
  periodMonthOf,
} from "@/server/modules/ledger/domain/period";
import { isLedgerSourceType } from "@/server/modules/ledger/domain/posting-rules";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

import { adminCall } from "../../_lib/boundary";
import { LedgerDenied } from "../_components/denied";
import { LedgerFrame } from "../_components/frame";
import { ReversePostingForm } from "../_components/reverse-form";
import { ledgerFeedbackLabels, ledgerMetadata } from "../_lib/copy";
import { monthLabel } from "../_lib/month";

export function generateMetadata() {
  return ledgerMetadata("detail");
}
const cell = "px-4 py-3 align-top";
const number = cn(cell, "text-right whitespace-nowrap tabular-nums");
const link = "inline-flex min-h-11 items-center text-link underline";

export default async function Page({
  params,
}: PageProps<"/admin/ledger/[seq]">) {
  const [actor, t, format] = await Promise.all([
    currentActor(),
    getTranslations("adminLedger"),
    getFormatter(),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { seq } = await params;
  const result = await adminCall(
    () => as(actor).getPosting(seq),
    adminLedgerPostingPath(seq)
  );
  if (!result.ok) return <LedgerDenied title={t("detail.title")} />;
  if (!result.value.ok) notFound();
  const posting = result.value.posting;
  const day = istDateOf(posting.occurredAt);
  const source = isLedgerSourceType(posting.sourceType)
    ? posting.sourceType
    : "other";

  return (
    <LedgerFrame
      title={`${t("detail.title")} #${posting.seq}`}
      back={t("back")}
    >
      <p className="text-ink-muted">
        <time dateTime={day}>
          {format.dateTime(posting.occurredAt, "long")}
        </time>{" "}
        · {t(`sources.${source}`)}
      </p>
      <p className="text-lead wrap-anywhere">{posting.description}</p>
      {posting.lateAdjustment ? (
        <p>
          {t("detail.lateAdjustment", {
            occurred: monthLabel(format, periodMonthOf(posting.occurredAt)),
            period: monthLabel(format, posting.periodMonth),
          })}
        </p>
      ) : null}
      {posting.reversalOfSeq ? (
        <p>
          {t("detail.reversalOf")}{" "}
          <SiteLink
            href={adminLedgerPostingPath(posting.reversalOfSeq)}
            className={link}
          >
            {posting.reversalOfSeq.toString()}
          </SiteLink>
        </p>
      ) : null}
      {posting.reversedBySeq ? (
        <p>
          {t("detail.reversedBy")}{" "}
          <SiteLink
            href={adminLedgerPostingPath(posting.reversedBySeq)}
            className={link}
          >
            {posting.reversedBySeq.toString()}
          </SiteLink>
        </p>
      ) : null}
      <TableScroller captionId="ledger-lines-caption">
        <table className="w-full text-left">
          <caption id="ledger-lines-caption" className="sr-only">
            {t("detail.caption")}
          </caption>
          <thead className="bg-surface-muted text-sm">
            <tr>
              <th scope="col" className={cell}>
                {t("detail.account")}
              </th>
              <th scope="col" className={number}>
                {t("debit")}
              </th>
              <th scope="col" className={number}>
                {t("credit")}
              </th>
              <th scope="col" className={cell}>
                {t("detail.memo")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {posting.lines.map((line) => (
              <tr key={line.lineNo}>
                <th scope="row" className={cn(cell, "min-w-32 wrap-anywhere")}>
                  {line.accountCode} {line.accountName}
                </th>
                <td className={number}>{formatPaise(line.debitMinor)}</td>
                <td className={number}>{formatPaise(line.creditMinor)}</td>
                <td className={cn(cell, "wrap-anywhere")}>{line.memo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
      {posting.sourceType === "manual" && !posting.reversedBySeq ? (
        <ReversePostingForm
          seq={posting.seq.toString()}
          labels={{
            saving: t("saving"),
            submit: t("detail.reverse"),
            feedback: ledgerFeedbackLabels(t, [
              "forbidden",
              "invalid_input",
              "not_found",
              "not_reversible",
              "already_reversed",
              "period_locked",
            ]),
          }}
        />
      ) : null}
    </LedgerFrame>
  );
}
