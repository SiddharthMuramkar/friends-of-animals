import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { RequestStatusChip } from "@/app/_components/privacy-request-chip";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import {
  ADMIN_PRIVACY_REQUESTS,
  adminPrivacyRequestPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { QueueFilter, QueueItem } from "@/server/modules/privacy/requests";

import { adminCall } from "../../_lib/boundary";
import { DueFlag } from "./_components/due-flag";
import { OfficerDenied } from "./_components/officer-denied";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGrievance.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

const VIEWS = ["open", "mine", "unassigned", "closed"] as const;
type View = (typeof VIEWS)[number];

const FILTERS: Record<View, QueueFilter> = {
  open: { status: "open" },
  mine: { status: "open", assignee: "me" },
  unassigned: { status: "open", assignee: "unassigned" },
  closed: { status: "closed" },
};

function viewHref(view: View): string {
  return view === "open"
    ? ADMIN_PRIVACY_REQUESTS
    : `${ADMIN_PRIVACY_REQUESTS}?view=${view}`;
}

/**
 * The grievance officer's queue (#115): open requests earliest due first,
 * overdue ones flagged with an icon and a word. It shows no free text.
 */
export default async function Page({
  searchParams,
}: PageProps<"/admin/privacy/requests">) {
  const t = await getTranslations("adminGrievance");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Queue searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Queue({
  searchParams,
}: Pick<PageProps<"/admin/privacy/requests">, "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const asked = (await searchParams).view;
  const view: View = VIEWS.find((each) => each === asked) ?? "open";
  const call = await adminCall(
    () => as(actor).listGrievanceQueue(FILTERS[view]),
    viewHref(view)
  );
  if (!call.ok) return <OfficerDenied />;
  if (!call.value.ok) throw new Error("The privacy queue refused its filter");
  const { requests, more } = call.value;
  const t = await getTranslations("adminGrievance");
  return (
    <div className="mt-8 flex flex-col gap-6">
      <nav aria-label={t("views.label")}>
        <ul className="flex flex-wrap gap-2">
          {VIEWS.map((option) => (
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
      {requests.length === 0 ? (
        <p className="text-ink-muted">{t(`empty.${view}`)}</p>
      ) : (
        <RequestTable requests={requests} view={view} />
      )}
      {more ? (
        <p className="text-sm text-ink-muted">
          {t("more", { count: requests.length })}
        </p>
      ) : null}
    </div>
  );
}

async function RequestTable({
  requests,
  view,
}: {
  requests: QueueItem[];
  view: View;
}) {
  const [t, format] = await Promise.all([
    getTranslations("adminGrievance"),
    getFormatter(),
  ]);
  const head = "px-4 py-3 whitespace-nowrap";
  const cell = "px-4 py-3 align-top";
  const date = (value: Date) => (
    <time dateTime={value.toISOString()}>{format.dateTime(value, "long")}</time>
  );
  return (
    <TableScroller captionId="grievance-caption">
      <table className="w-full text-left">
        <caption id="grievance-caption" className="sr-only">
          {t("table.caption", { view })}
        </caption>
        <thead className="bg-surface-muted text-sm">
          <tr>
            <th scope="col" className={head}>
              {t("table.reference")}
            </th>
            <th scope="col" className={head}>
              {t("table.type")}
            </th>
            <th scope="col" className={head}>
              {t("table.relation")}
            </th>
            <th scope="col" className={head}>
              {t("table.status")}
            </th>
            <th scope="col" className={head}>
              {view === "closed" ? t("table.closed") : t("table.due")}
            </th>
            <th scope="col" className={head}>
              {t("table.assignee")}
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id} className="border-t border-border">
              <th scope="row" className={cell}>
                <SiteLink
                  href={adminPrivacyRequestPath(request.id)}
                  className={`${LINK} font-mono`}
                >
                  {request.reference}
                </SiteLink>
              </th>
              <td className={cell}>{t(`types.${request.type}`)}</td>
              <td className={cell}>{t(`relations.${request.relation}`)}</td>
              <td className={cell}>
                <RequestStatusChip
                  status={request.status}
                  namespace="adminGrievance.statuses"
                />
              </td>
              <td className={`${cell} whitespace-nowrap`}>
                {view === "closed" && request.closedAt ? (
                  date(request.closedAt)
                ) : (
                  <span className="flex flex-col gap-1">
                    {date(request.dueAt)}
                    <DueFlag
                      overdue={request.overdue}
                      daysLeft={request.daysLeft}
                    />
                  </span>
                )}
              </td>
              <td className={cell}>{request.assignee?.name ?? t("nobody")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
