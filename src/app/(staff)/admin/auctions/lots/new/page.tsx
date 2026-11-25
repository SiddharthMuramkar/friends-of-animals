import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { inputStyles } from "@/components/form";
import { ADMIN_AUCTIONS, ADMIN_AUCTIONS_NEW } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { AdminDenied } from "../../../_components/admin-denied";
import { adminCall } from "../../../_lib/boundary";
import { createAuctionLot } from "../../_lib/actions";

export const instant = false;
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auctions.admin");
  return { title: t("new"), robots: { index: false, follow: false } };
}
export default async function Page({
  searchParams,
}: PageProps<"/admin/auctions/lots/new">) {
  const actor = await currentActor();
  const [t, loaded, query] = await Promise.all([
    getTranslations("auctions.admin"),
    adminCall(() => as(actor).listEligibleArtwork(), ADMIN_AUCTIONS_NEW),
    searchParams,
  ]);
  return (
    <Section hue="yellow" width="wide" className="pt-10 sm:pt-14">
      <ButtonLink href={ADMIN_AUCTIONS} variant="quiet">
        {t("back")}
      </ButtonLink>
      <PageHeader className="mt-5" title={t("new")} />
      {query.result === "error" ? (
        <p role="alert" className="mt-5 text-ink">
          {t("error")}
        </p>
      ) : null}
      {!loaded.ok ? (
        <AdminDenied />
      ) : loaded.value.length === 0 ? (
        <p className="mt-5 text-ink">{t("noArtwork")}</p>
      ) : (
        <form
          action={createAuctionLot}
          className="mt-6 max-w-2xl space-y-5 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6"
        >
          <div className="space-y-2">
            <label htmlFor="auction-artwork" className="font-semibold text-ink">
              {t("select")}
            </label>
            <select
              id="auction-artwork"
              name="artworkId"
              className={inputStyles}
              required
            >
              {loaded.value.map((a) => (
                <option key={a.artworkId} value={a.artworkId}>
                  {a.artworkCode} · {a.credit}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="auction-story" className="font-semibold text-ink">
              {t("story")}
            </label>
            <p id="story-hint" className="text-sm text-ink-muted">
              {t("storyHint")}
            </p>
            <textarea
              id="auction-story"
              aria-describedby="story-hint"
              name="story"
              required
              maxLength={2000}
              rows={5}
              className={inputStyles}
            />
          </div>
          <fieldset className="space-y-4">
            <legend className="font-semibold text-ink">{t("terms")}</legend>
            {(["base", "reserve", "opens", "closes"] as const).map((key) => (
              <div key={key} className="space-y-2">
                <label
                  htmlFor={`auction-${key}`}
                  className="block font-semibold text-ink"
                >
                  {t(key)}
                </label>
                {key === "base" || key === "reserve" ? (
                  <input
                    id={`auction-${key}`}
                    name={key}
                    className={inputStyles}
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]{1,17}(\.[0-9]{1,2})?"
                    required
                  />
                ) : (
                  <input
                    id={`auction-${key}`}
                    name={`${key}At`}
                    type="datetime-local"
                    className={inputStyles}
                    required
                  />
                )}
              </div>
            ))}
            <p className="text-sm text-ink-muted">{t("reserveNote")}</p>
          </fieldset>
          <button type="submit" className={buttonStyles()}>
            {t("create")}
          </button>
        </form>
      )}
    </Section>
  );
}
