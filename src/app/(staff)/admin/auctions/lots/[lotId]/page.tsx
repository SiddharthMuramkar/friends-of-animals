import type { Metadata } from "next";
import { getTranslations, getFormatter } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { inputStyles } from "@/components/form";
import { ADMIN_AUCTIONS, adminAuctionLotPath } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { AdminDenied } from "../../../_components/admin-denied";
import { adminCall } from "../../../_lib/boundary";
import { scheduleAuctionLot, cancelAuctionLot } from "../../_lib/actions";
import { formatPaise } from "@/app/auctions/_lot-details";

export const instant = false;
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auctions.admin");
  return { title: t("title"), robots: { index: false, follow: false } };
}
export default async function Page({
  params,
  searchParams,
}: PageProps<"/admin/auctions/lots/[lotId]">) {
  const actor = await currentActor();
  const { lotId } = await params;
  const [t, pub, words, format, query, loaded] = await Promise.all([
    getTranslations("auctions.admin"),
    getTranslations("auctions"),
    getTranslations("auctions.status"),
    getFormatter(),
    searchParams,
    adminCall(
      () => as(actor).getLotForAdmin({ lotId }),
      adminAuctionLotPath(lotId)
    ),
  ]);
  if (loaded.ok && !loaded.value) notFound();
  const lot = loaded.ok ? loaded.value : null;
  const when = (value: Date) =>
    format.dateTime(value, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    });
  return (
    <Section hue="yellow" width="wide" className="pt-10 sm:pt-14">
      <ButtonLink href={ADMIN_AUCTIONS} variant="quiet">
        {t("back")}
      </ButtonLink>
      <PageHeader className="mt-4" title={lot?.lotCode ?? t("title")} />
      {!lot ? (
        <AdminDenied />
      ) : (
        <>
          {query.result ? (
            <output className="mt-5 block text-ink">
              {t(
                query.result === "ok"
                  ? "result"
                  : query.result === "disabled"
                    ? "disabled"
                    : "error"
              )}
            </output>
          ) : null}
          <article className="mt-6 max-w-2xl rounded-3xl border-2 border-border bg-surface p-5">
            <h2 className="text-h3 text-ink">{words(lot.status)}</h2>
            <p className="mt-4 text-ink">
              {lot.creatorCredit
                ? pub("credit", { name: lot.creatorCredit })
                : t("noCredit")}
            </p>
            <p className="mt-4 text-ink wrap-anywhere whitespace-pre-wrap">
              {lot.story}
            </p>
            <dl className="mt-5 space-y-3 text-ink">
              <div>
                <dt className="font-semibold">{pub("base")}</dt>
                <dd>{formatPaise(lot.basePricePaise)}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t("reserve")}</dt>
                <dd>{formatPaise(lot.reservePricePaise)}</dd>
              </div>
              <div>
                <dt className="font-semibold">{pub("opens")}</dt>
                <dd>{when(lot.opensAt)}</dd>
              </div>
              <div>
                <dt className="font-semibold">{pub("closes")}</dt>
                <dd>{when(lot.closesAt)}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t("previous")}</dt>
                <dd>{lot.artworkStatusBeforeListing.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt className="font-semibold">{pub("award")}</dt>
                <dd>{lot.award ?? t("noAward")}</dd>
              </div>
            </dl>
          </article>
          {lot.status === "draft" && lot.creatorCredit ? (
            <form
              action={scheduleAuctionLot.bind(null, lot.id)}
              className="mt-5"
            >
              <button type="submit" className={buttonStyles()}>
                {t("schedule")}
              </button>
            </form>
          ) : null}
          {["draft", "scheduled", "open"].includes(lot.status) ? (
            <form
              action={cancelAuctionLot.bind(null, lot.id)}
              className="mt-5 max-w-2xl space-y-3 rounded-2xl border-2 border-border bg-surface p-5"
            >
              <label htmlFor="reason" className="block font-semibold text-ink">
                {t("reason")}
              </label>
              <textarea
                id="reason"
                className={inputStyles}
                name="reason"
                required
                maxLength={500}
                rows={3}
              />
              <button
                type="submit"
                className={buttonStyles({ variant: "secondary" })}
              >
                {t("cancel")}
              </button>
            </form>
          ) : null}
        </>
      )}
    </Section>
  );
}
