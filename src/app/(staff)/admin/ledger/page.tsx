import { redirect } from "next/navigation";

import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import {
  ADMIN_LEDGER,
  ADMIN_LEDGER_ACCOUNTS,
  ADMIN_NEW_LEDGER_ENTRY,
  adminLedgerPostingPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { istDateOf } from "@/server/modules/ledger/domain/period";
import { isLedgerSourceType } from "@/server/modules/ledger/domain/posting-rules";
import type { listPostings } from "@/server/modules/ledger/queries";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

import { adminCall } from "../_lib/boundary";
import { LedgerFrame } from "./_components/frame";
import { LedgerFormFeedback } from "./_components/form-feedback";
import { copy, ledgerMetadata } from "./_lib/copy";

export const metadata = ledgerMetadata(copy.list.title);
const t = copy.list;
const cell = "px-4 py-3 align-top";
const number = `${cell} text-right whitespace-nowrap tabular-nums`;
const tableHeaders = [
  t.number,
  t.date,
  t.description,
  t.source,
  copy.debit,
  copy.credit,
];

export default async function Page({
  searchParams,
}: PageProps<"/admin/ledger">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? params[key] : undefined;
  const filters = {
    accountCode: one("accountCode"),
    from: one("from"),
    to: one("to"),
  };
  const cursor = one("cursor");
  const ledger = as(actor);
  const view = await adminCall(
    () =>
      Promise.all([
        ledger.listPostings({ ...filters, cursor }),
        ledger.listLedgerAccounts(),
      ]),
    ADMIN_LEDGER
  );
  if (!view.ok)
    return (
      <LedgerFrame title={t.title}>
        <p>{copy.denied}</p>
      </LedgerFrame>
    );
  const [result, accounts] = view.value;
  const categories = accounts
    .filter(({ kind }) => kind === "income" || kind === "expense")
    .map(({ code, name }) => ({ value: code, label: `${code} ${name}` }));
  const older = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) older.set(key, value);
  }
  const filtered = older.size > 0 || cursor !== undefined;
  if (result.ok && result.nextCursor)
    older.set("cursor", result.nextCursor.toString());

  return (
    <LedgerFrame title={t.title}>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href={ADMIN_NEW_LEDGER_ENTRY}>{t.newEntry}</ButtonLink>
        <ButtonLink href={ADMIN_LEDGER_ACCOUNTS} variant="secondary">
          {t.accounts}
        </ButtonLink>
      </div>
      <search>
        <form action={ADMIN_LEDGER} method="get" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              id="ledger-category"
              name="accountCode"
              label={t.category}
              options={categories}
              placeholder={t.allCategories}
              defaultValue={filters.accountCode ?? ""}
            />
            <TextField
              id="ledger-from"
              name="from"
              label={t.from}
              type="date"
              defaultValue={filters.from}
            />
            <TextField
              id="ledger-to"
              name="to"
              label={t.to}
              type="date"
              defaultValue={filters.to}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className={buttonStyles({ variant: "secondary" })}
            >
              {t.apply}
            </button>
            {filtered ? (
              <ButtonLink href={ADMIN_LEDGER} variant="quiet">
                {t.clear}
              </ButtonLink>
            ) : null}
          </div>
        </form>
      </search>
      {result.ok ? (
        <>
          <PostingTable result={result} />
          {result.nextCursor ? (
            <ButtonLink variant="secondary" href={`${ADMIN_LEDGER}?${older}`}>
              {t.older}
            </ButtonLink>
          ) : null}
        </>
      ) : (
        <LedgerFormFeedback state={{ error: result.error }} />
      )}
    </LedgerFrame>
  );
}

function PostingTable({
  result,
}: {
  result: Extract<Awaited<ReturnType<typeof listPostings>>, { ok: true }>;
}) {
  if (result.postings.length === 0)
    return <p className="text-ink-muted">{t.empty}</p>;
  return (
    <TableScroller
      captionId="ledger-postings-caption"
      className="max-h-[70vh] overflow-auto"
    >
      <table className="w-full text-left">
        <caption id="ledger-postings-caption" className="sr-only">
          {t.caption}
        </caption>
        <thead className="sticky top-0 z-10 bg-surface-muted text-sm">
          <tr>
            {tableHeaders.map((heading, index) => (
              <th
                key={heading}
                scope="col"
                className={index >= 4 ? number : `${cell} whitespace-nowrap`}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {result.postings.map((posting) => {
            const day = istDateOf(posting.occurredAt);
            return (
              <tr key={posting.seq.toString()}>
                <th
                  scope="row"
                  className={`${cell} sticky start-0 bg-surface whitespace-nowrap`}
                >
                  <SiteLink
                    href={adminLedgerPostingPath(posting.seq)}
                    className="inline-flex min-h-11 items-center text-link underline"
                  >
                    {posting.seq.toString()}
                  </SiteLink>
                </th>
                <td className={`${cell} whitespace-nowrap`}>
                  <time dateTime={day}>{day}</time>
                </td>
                <td className={`${cell} min-w-36 wrap-anywhere`}>
                  {posting.description}
                </td>
                <td className={cell}>
                  {isLedgerSourceType(posting.sourceType)
                    ? copy.sources[posting.sourceType]
                    : copy.sources.other}
                </td>
                <td className={number}>{formatPaise(posting.debitMinor)}</td>
                <td className={number}>{formatPaise(posting.creditMinor)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-border bg-surface-muted font-semibold">
          <tr>
            <th scope="row" className={cell} colSpan={4}>
              {t.total}
            </th>
            <td className={number}>{formatPaise(result.totals.debitMinor)}</td>
            <td className={number}>{formatPaise(result.totals.creditMinor)}</td>
          </tr>
        </tfoot>
      </table>
    </TableScroller>
  );
}
