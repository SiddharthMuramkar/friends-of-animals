import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { myPrivacyRequestPath, NEW_PRIVACY_REQUEST } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { MyRequestItem } from "@/server/modules/privacy/requests";

import { RequestStatusChip } from "@/app/_components/privacy-request-chip";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacyRequests.list.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/**
 * A user's privacy requests (#115): what they asked, about whom, where each
 * stands and when it is due. A guardian also sees their teen's own.
 */
export default async function Page() {
  const t = await getTranslations("privacyRequests.list");
  return (
    <Section hue="blue" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Requests />
      </Suspense>
    </Section>
  );
}

async function Requests() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, requests] = await Promise.all([
    getTranslations("privacyRequests.list"),
    as(actor).listMyPrivacyRequests(),
  ]);
  return (
    <div className="mt-8 flex flex-col gap-6">
      <div>
        <ButtonLink href={NEW_PRIVACY_REQUEST}>{t("new")}</ButtonLink>
      </div>
      {requests.length === 0 ? (
        <p className="text-ink-muted">{t("empty")}</p>
      ) : (
        <RequestTable requests={requests} />
      )}
    </div>
  );
}

async function RequestTable({ requests }: { requests: MyRequestItem[] }) {
  const [t, types, about, format] = await Promise.all([
    getTranslations("privacyRequests.list"),
    getTranslations("privacyRequests.types"),
    getTranslations("privacyRequests.about"),
    getFormatter(),
  ]);
  const head = "px-4 py-3 whitespace-nowrap";
  const cell = "px-4 py-3 align-top";
  const date = (value: Date) => (
    <time dateTime={value.toISOString()}>{format.dateTime(value, "long")}</time>
  );
  return (
    <TableScroller captionId="privacy-requests-caption">
      <table className="w-full text-left">
        <caption id="privacy-requests-caption" className="sr-only">
          {t("caption")}
        </caption>
        <thead className="bg-surface-muted text-sm">
          <tr>
            <th scope="col" className={head}>
              {t("reference")}
            </th>
            <th scope="col" className={head}>
              {t("type")}
            </th>
            <th scope="col" className={head}>
              {t("aboutHeading")}
            </th>
            <th scope="col" className={head}>
              {t("status")}
            </th>
            <th scope="col" className={head}>
              {t("filed")}
            </th>
            <th scope="col" className={head}>
              {t("due")}
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id} className="border-t border-border">
              <th scope="row" className={cell}>
                <SiteLink
                  href={myPrivacyRequestPath(request.id)}
                  className={`${LINK} font-mono`}
                >
                  {request.reference}
                </SiteLink>
              </th>
              <td className={cell}>{types(request.type)}</td>
              <td className={cell}>
                {request.about.kind === "self"
                  ? about("self")
                  : request.about.name === ""
                    ? about("erasedChild")
                    : about("child", { name: request.about.name })}
                {request.filedByYou ? null : (
                  <span className="block text-sm text-ink-muted">
                    {t("filedByChild")}
                  </span>
                )}
              </td>
              <td className={cell}>
                <RequestStatusChip
                  status={request.status}
                  namespace="privacyRequests.statuses"
                />
              </td>
              <td className={`${cell} whitespace-nowrap`}>
                {date(request.createdAt)}
              </td>
              <td className={`${cell} whitespace-nowrap`}>
                {date(request.dueAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
