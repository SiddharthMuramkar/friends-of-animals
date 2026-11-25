import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { Callout } from "@/components/site/callout";
import { Chip } from "@/components/site/chip";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { adoptionPath, myListingPath, newAdoptionPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { NotYours, unlessForbidden } from "./_components/forbidden";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adoption.manage.list.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/organisation/[id]/adoptions">;
type ParamsOnly = Pick<Props, "params">;

export default async function Page({ params }: Props) {
  const t = await getTranslations("adoption.manage");
  return (
    <Section hue="green" tone="tint" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Animals params={params} />
      </Suspense>
    </Section>
  );
}

const CELL = "px-4 py-3 text-start align-top";

async function Animals({ params }: ParamsOnly) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, t, manage, status, format] = await Promise.all([
    params,
    getTranslations("adoption.manage.list"),
    getTranslations("adoption.manage"),
    getTranslations("adoption.status"),
    getFormatter(),
  ]);
  const result = await unlessForbidden(() =>
    as(actor).listAdoptionListings({ directoryListingId: id })
  );
  if (!result?.ok) return <NotYours />;
  const { directory, listings } = result;

  return (
    <div className="flex flex-col gap-8">
      <ButtonLink
        href={myListingPath(directory.id)}
        variant="quiet"
        className="-ms-5 self-start"
      >
        {manage("back")}
      </ButtonLink>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("title", { name: directory.name })}
        lead={t("lead")}
        className="wrap-anywhere"
      />
      {directory.verified ? (
        <div>
          <ButtonLink href={newAdoptionPath(directory.id)}>
            {t("add")}
          </ButtonLink>
        </div>
      ) : (
        <Callout tone="warning">
          <p>{manage("notVerified")}</p>
        </Callout>
      )}
      {listings.length === 0 ? (
        <p className="text-ink">{t("empty")}</p>
      ) : (
        <TableScroller captionId="animals-caption">
          <table className="w-full min-w-xl border-collapse">
            <caption id="animals-caption" className="sr-only">
              {t("title", { name: directory.name })}
            </caption>
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className={CELL}>
                  {t("name")}
                </th>
                <th scope="col" className={CELL}>
                  {t("status")}
                </th>
                <th scope="col" className={CELL}>
                  {t("photos")}
                </th>
                <th scope="col" className={CELL}>
                  {t("updated")}
                </th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr key={listing.id} className="border-b border-border">
                  <th scope="row" className={CELL}>
                    <SiteLink
                      href={adoptionPath(directory.id, listing.id)}
                      className="inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover wrap-anywhere"
                    >
                      {listing.name}
                    </SiteLink>
                  </th>
                  <td className={CELL}>
                    <Chip
                      tone={
                        listing.status === "published" ? "green" : "neutral"
                      }
                    >
                      {status(listing.status)}
                    </Chip>
                  </td>
                  <td className={CELL}>{format.number(listing.photoCount)}</td>
                  <td className={CELL}>
                    {format.dateTime(listing.updatedAt, {
                      dateStyle: "medium",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
    </div>
  );
}
