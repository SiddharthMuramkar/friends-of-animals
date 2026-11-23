import { notFound, redirect } from "next/navigation";

import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { adminLedgerPostingPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { istDateOf } from "@/server/modules/ledger/domain/period";
import { isLedgerSourceType } from "@/server/modules/ledger/domain/posting-rules";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

import { adminCall } from "../../_lib/boundary";
import { LedgerFrame } from "../_components/frame";
import { ReversePostingForm } from "../_components/reverse-form";
import { copy, ledgerMetadata } from "../_lib/copy";

const t = copy.detail;
export const metadata = ledgerMetadata(t.title);
const cell = "px-4 py-3 align-top";
const number = `${cell} text-right whitespace-nowrap tabular-nums`;
const link = "inline-flex min-h-11 items-center text-link underline";

export default async function Page({
  params,
}: PageProps<"/admin/ledger/[seq]">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { seq } = await params;
  const result = await adminCall(
    () => as(actor).getPosting(seq),
    adminLedgerPostingPath(seq)
  );
  if (!result.ok)
    return (
      <LedgerFrame title={t.title} back>
        <p>{copy.denied}</p>
      </LedgerFrame>
    );
  if (!result.value.ok) notFound();
  const posting = result.value.posting;
  const day = istDateOf(posting.occurredAt);
  const source = isLedgerSourceType(posting.sourceType)
    ? copy.sources[posting.sourceType]
    : copy.sources.other;

  return (
    <LedgerFrame title={`${t.title} #${posting.seq}`} back>
      <p className="text-ink-muted">
        <time dateTime={day}>{day}</time> · {source}
      </p>
      <p className="text-lead wrap-anywhere">{posting.description}</p>
      {posting.reversalOfSeq ? (
        <p>
          {t.reversalOf}{" "}
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
          {t.reversedBy}{" "}
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
            {t.caption}
          </caption>
          <thead className="bg-surface-muted text-sm">
            <tr>
              <th scope="col" className={cell}>
                {t.account}
              </th>
              <th scope="col" className={number}>
                {copy.debit}
              </th>
              <th scope="col" className={number}>
                {copy.credit}
              </th>
              <th scope="col" className={cell}>
                {t.memo}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {posting.lines.map((line) => (
              <tr key={line.lineNo}>
                <th scope="row" className={`${cell} min-w-32 wrap-anywhere`}>
                  {line.accountCode} {line.accountName}
                </th>
                <td className={number}>{formatPaise(line.debitMinor)}</td>
                <td className={number}>{formatPaise(line.creditMinor)}</td>
                <td className={`${cell} wrap-anywhere`}>{line.memo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
      {posting.sourceType === "manual" && !posting.reversedBySeq ? (
        <ReversePostingForm seq={posting.seq.toString()} />
      ) : null}
    </LedgerFrame>
  );
}
