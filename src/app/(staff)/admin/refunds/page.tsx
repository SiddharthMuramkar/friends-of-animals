import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Chip } from "@/components/site/chip";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { ADMIN_REFUNDS, adminRefundPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type {
  RefundListItem,
  RefundListState,
} from "@/server/modules/payments";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { REFUND_LIST_STATES } from "@/server/modules/payments/refunds/list-refunds";

import { adminCall } from "../_lib/boundary";
import { RefundsDenied } from "./_components/refunds-denied";
import { statusTone } from "./_lib/status-tone";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminRefunds.list.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

const viewHref = (view: RefundListState) =>
  view === "waiting" ? ADMIN_REFUNDS : `${ADMIN_REFUNDS}?view=${view}`;

/**
 * The refunds queue (#80): refunds waiting for finance by default, those
 * on their way with `?view=in_progress`, and done ones with `?view=done`.
 * Finance, staff admins, super admins and global competition managers.
 */
export default async function Page({
  searchParams,
}: PageProps<"/admin/refunds">) {
  const t = await getTranslations("adminRefunds");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="yellow"
        title={t("list.title")}
        lead={t("list.lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Refunds searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Refunds({
  searchParams,
}: {
  searchParams: PageProps<"/admin/refunds">["searchParams"];
}) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const asked = (await searchParams).view;
  const view: RefundListState =
    typeof asked === "string" &&
    (REFUND_LIST_STATES as readonly string[]).includes(asked)
      ? (asked as RefundListState)
      : "waiting";
  const call = await adminCall(
    () => as(actor).listRefunds({ state: view }),
    viewHref(view)
  );
  if (!call.ok) return <RefundsDenied />;
  // The view was normalised above, so the use case can't find it invalid.
  if (!call.value.ok) throw new Error("The refunds list refused its view");
  const { refunds } = call.value;
  const t = await getTranslations("adminRefunds.list");

  return (
    <div className="mt-8 flex flex-col gap-6">
      <nav aria-label={t("nav")}>
        <ul className="flex flex-wrap gap-2">
          {REFUND_LIST_STATES.map((option) => (
            <li key={option}>
              <SiteLink
                href={viewHref(option)}
                aria-current={option === view ? "page" : undefined}
                className="inline-flex min-h-11 items-center rounded-full border-2 border-border-strong bg-surface px-4 py-1.5 font-semibold text-ink hover:border-ink aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-surface"
              >
                {t(`views.${option}`)}
              </SiteLink>
            </li>
          ))}
        </ul>
      </nav>
      {refunds.length === 0 ? (
        <p className="text-ink-muted">{t(`empty.${view}`)}</p>
      ) : (
        <RefundTable refunds={refunds} view={view} />
      )}
    </div>
  );
}

async function RefundTable({
  refunds,
  view,
}: {
  refunds: RefundListItem[];
  view: RefundListState;
}) {
  const [t, format] = await Promise.all([
    getTranslations("adminRefunds"),
    getFormatter(),
  ]);
  const head = "px-4 py-3 whitespace-nowrap";
  const cell = "px-4 py-3 align-top";
  return (
    <TableScroller captionId="refunds-caption">
      <table className="w-full text-left">
        <caption id="refunds-caption" className="sr-only">
          {t("list.table.caption", { view: t(`list.views.${view}`) })}
        </caption>
        <thead className="bg-surface-muted text-sm">
          <tr>
            <th scope="col" className={head}>
              {t("list.table.refund")}
            </th>
            <th scope="col" className={head}>
              {t("detail.details.payer")}
            </th>
            <th scope="col" className={head}>
              {t("list.table.competition")}
            </th>
            <th scope="col" className={head}>
              {t("list.table.kind")}
            </th>
            <th scope="col" className={head}>
              {t("list.table.status")}
            </th>
            <th scope="col" className={head}>
              {t("list.table.requested")}
            </th>
          </tr>
        </thead>
        <tbody>
          {refunds.map((each) => {
            const amount = formatPaise(each.amountMinor);
            const payer = each.payer?.name ?? t("payer.unknown");
            return (
              <tr key={each.id} className="border-t border-border">
                <th scope="row" className={cell}>
                  <SiteLink
                    href={adminRefundPath(each.id)}
                    className={LINK}
                    aria-label={t("list.table.open", { amount, payer })}
                  >
                    {amount}
                  </SiteLink>
                  <span className="block text-sm font-normal text-ink-muted">
                    {t("students", { count: each.students })}
                  </span>
                </th>
                <td className={`${cell} wrap-anywhere`}>{payer}</td>
                <td className={`${cell} wrap-anywhere`}>
                  {each.competitionName}
                </td>
                <td className={cell}>{t(`kinds.${each.kind}`)}</td>
                <td className={cell}>
                  <Chip tone={statusTone(each.status)}>
                    {t(`statuses.${each.status}`)}
                  </Chip>
                </td>
                <td className={`${cell} whitespace-nowrap`}>
                  <time dateTime={each.requestedAt.toISOString()}>
                    {format.dateTime(each.requestedAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}
