import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { TextAreaField } from "@/components/form/text-area-field";
import { TableScroller } from "@/components/site/table-scroller";
import { ADMIN_LEDGER_APPROVALS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { as, currentActor, type UseCases } from "@/server/app";
import { parseIstDate } from "@/server/modules/ledger/domain/period";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

import { adminCall } from "../../_lib/boundary";
import { LedgerDenied } from "../_components/denied";
import { LedgerFrame } from "../_components/frame";
import { PeriodOutcomeNotice } from "../_components/period-notice";
import { monthLabel } from "../_lib/month";
import {
  approveRequestAction,
  cancelRequestAction,
  rejectRequestAction,
} from "../_lib/period-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminLedgerPeriods.approvals");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Request = Awaited<
  ReturnType<UseCases["listFinanceRequests"]>
>["pending"][number];

const cell = "px-4 py-3 align-top";
const number = cn(cell, "text-right whitespace-nowrap tabular-nums");

export default async function Page({
  searchParams,
}: PageProps<"/admin/ledger/approvals">) {
  const [actor, t, ledger, format] = await Promise.all([
    currentActor(),
    getTranslations("adminLedgerPeriods"),
    getTranslations("adminLedger"),
    getFormatter(),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const result = await adminCall(
    () => as(actor).listFinanceRequests(),
    ADMIN_LEDGER_APPROVALS
  );
  if (!result.ok) return <LedgerDenied title={t("approvals.title")} />;
  const { pending, decided, thresholdRupees } = result.value;
  const search = await searchParams;

  return (
    <LedgerFrame title={t("approvals.title")} back={ledger("back")}>
      <PeriodOutcomeNotice search={search} />
      {search.requested === "entry" ? (
        <FormAlert tone="success" label={t("approvals.pendingTitle")}>
          <p>{t("approvals.requestedEntry")}</p>
        </FormAlert>
      ) : null}
      <p className="max-w-prose">
        {t("approvals.lead", {
          threshold: format.number(thresholdRupees),
        })}
      </p>
      <section aria-labelledby="pending-title" className="space-y-4">
        <h2 id="pending-title" className="text-h3 font-semibold">
          {t("approvals.pendingTitle")}
        </h2>
        {pending.length === 0 ? (
          <p className="text-ink-muted">{t("approvals.noPending")}</p>
        ) : (
          <ul className="space-y-4">
            {pending.map((request) => (
              <li
                key={request.id}
                className="space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-6"
              >
                <RequestDetails request={request} />
                <RequestActions request={request} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="decided-title" className="space-y-4">
        <h2 id="decided-title" className="text-h3 font-semibold">
          {t("approvals.decidedTitle")}
        </h2>
        {decided.length === 0 ? (
          <p className="text-ink-muted">{t("approvals.noDecided")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {decided.map((request) => (
              <li key={request.id} className="space-y-2 p-4 sm:p-6">
                <RequestDetails request={request} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </LedgerFrame>
  );
}

async function RequestDetails({ request }: { request: Request }) {
  const [t, ledger, format] = await Promise.all([
    getTranslations("adminLedgerPeriods.approvals"),
    getTranslations("adminLedger"),
    getFormatter(),
  ]);
  const { summary } = request;
  const title =
    summary.kind === "manual_entry"
      ? t("operation.manual_entry", {
          amount:
            summary.totalMinor === null ? "" : formatPaise(summary.totalMinor),
          date: entryDate(format, summary.date),
        })
      : summary.kind === "period_lock" || summary.kind === "period_unlock"
        ? t(`operation.${summary.kind}`, {
            month: monthLabel(format, summary.month),
          })
        : t("operation.unknown");
  const requestedOn = format.dateTime(request.requestedAt, "long");
  const status = t(`status.${request.status}`);
  return (
    <div className="space-y-2">
      <h3 className="text-lead font-semibold wrap-anywhere">{title}</h3>
      <p className="text-ink-muted">
        {request.mine
          ? t("requestedByYou", { date: requestedOn })
          : t("requestedBy", {
              name: request.requesterName ?? "",
              date: requestedOn,
            })}{" "}
        {request.status === "pending"
          ? request.overdue
            ? t("overdue")
            : t("expires", {
                date: format.dateTime(request.expiresAt, "long"),
              })
          : request.decidedAt
            ? request.deciderName
              ? t("decidedBy", {
                  status,
                  name: request.deciderName,
                  date: format.dateTime(request.decidedAt, "long"),
                })
              : t("decidedOn", {
                  status,
                  date: format.dateTime(request.decidedAt, "long"),
                })
            : status}
      </p>
      {summary.kind === "period_unlock" && summary.reason ? (
        <p className="wrap-anywhere">
          {t("reason", { reason: summary.reason })}
        </p>
      ) : null}
      {request.status === "rejected" && request.decisionReason ? (
        <p className="wrap-anywhere">
          {t("rejectedBecause", { reason: request.decisionReason })}
        </p>
      ) : null}
      {summary.kind === "manual_entry" ? (
        <p className="wrap-anywhere">{summary.description}</p>
      ) : null}
      {summary.kind === "manual_entry" && request.status === "pending" ? (
        <>
          <TableScroller captionId={`lines-${request.id}`}>
            <table className="w-full text-left">
              <caption id={`lines-${request.id}`} className="sr-only">
                {t("linesCaption", {
                  description: summary.description,
                  date: requestedOn,
                })}
              </caption>
              <thead className="bg-surface-muted text-sm">
                <tr>
                  <th scope="col" className={cell}>
                    {t("account")}
                  </th>
                  <th scope="col" className={number}>
                    {ledger("debit")}
                  </th>
                  <th scope="col" className={number}>
                    {ledger("credit")}
                  </th>
                  <th scope="col" className={cell}>
                    {t("memo")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.lines.map((line, index) => (
                  <tr key={index}>
                    <th scope="row" className={cell}>
                      {line.accountCode}
                    </th>
                    <td className={number}>
                      {line.side === "debit"
                        ? formatPaise(line.amountMinor)
                        : ""}
                    </td>
                    <td className={number}>
                      {line.side === "credit"
                        ? formatPaise(line.amountMinor)
                        : ""}
                    </td>
                    <td className={cn(cell, "wrap-anywhere")}>{line.memo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </>
      ) : null}
    </div>
  );
}

function entryDate(
  format: Awaited<ReturnType<typeof getFormatter>>,
  date: string
) {
  const day = parseIstDate(date);
  return day.ok ? format.dateTime(day.start, "long") : date;
}

async function RequestActions({ request }: { request: Request }) {
  const t = await getTranslations("adminLedgerPeriods.approvals");
  if (!request.canApprove && !request.canCancel) {
    return request.mine && !request.overdue ? (
      <p className="text-ink-muted">{t("ownRequest")}</p>
    ) : null;
  }
  return (
    <div className="space-y-4">
      {request.canApprove ? (
        <form action={approveRequestAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <SubmitButton pendingLabel={t("approving")}>
            {t("approve")}
          </SubmitButton>
        </form>
      ) : null}
      {request.canReject ? (
        <form action={rejectRequestAction} className="space-y-3">
          <input type="hidden" name="requestId" value={request.id} />
          <TextAreaField
            id={`reject-reason-${request.id}`}
            name="reason"
            label={t("rejectReason")}
            rows={2}
            maxLength={500}
            required
          />
          <SubmitButton variant="secondary" pendingLabel={t("rejecting")}>
            {t("reject")}
          </SubmitButton>
        </form>
      ) : null}
      {request.canCancel ? (
        <>
          <p className="text-ink-muted">{t("ownRequest")}</p>
          <form action={cancelRequestAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <SubmitButton variant="secondary" pendingLabel={t("cancelling")}>
              {t("cancel")}
            </SubmitButton>
          </form>
        </>
      ) : null}
    </div>
  );
}
