import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink } from "@/components/site/button-link";
import { buttonStyles } from "@/components/site/button-link";
import { as, currentActor } from "@/server/app";
import {
  ADMIN_ARTWORK,
  ADMIN_ARTWORK_DISCREPANCIES,
  adminArtworkPath,
} from "@/lib/app-routes";
import { adminCall } from "../_lib/boundary";
import { AdminDenied } from "../_components/admin-denied";
import { requestArtworks } from "./_lib/actions";
const field =
  "block w-full rounded-xl border-2 border-border-strong bg-surface p-2 text-ink";
// Signed-in, nonce-CSP pages read their actor and artwork at request time.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("artwork");
  return { title: t("title"), robots: { index: false, follow: false } };
}
export default async function Page({
  searchParams,
}: PageProps<"/admin/artwork">) {
  const [actor, t, query] = await Promise.all([
    currentActor(),
    getTranslations("artwork"),
    searchParams,
  ]);
  const custody = await getTranslations("artworkCustody");
  const app = as(actor);
  const discrepancies = await adminCall(
    () => app.listArtworkDiscrepancies({}),
    ADMIN_ARTWORK
  );
  const comps = await adminCall(
    () => app.listArtworkCompetitions(),
    ADMIN_ARTWORK
  );
  const chosen = comps.ok
    ? (comps.value.find((c) => c.id === query.competition) ?? comps.value[0])
    : undefined;
  const loaded = chosen
    ? await adminCall(
        async () =>
          Promise.all([
            app.listArtworks({
              competitionId: chosen.id,
              ...(typeof query.q === "string" ? { query: query.q } : {}),
            }),
            app.listArtworkCandidates({ competitionId: chosen.id }),
          ]),
        ADMIN_ARTWORK
      )
    : null;
  return (
    <Section width="wide" hue="green" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("lead")} />
      {discrepancies.ok && discrepancies.value.ok ? (
        <ButtonLink
          href={ADMIN_ARTWORK_DISCREPANCIES}
          variant="secondary"
          className="mt-4"
        >
          {custody("discrepancies")}
        </ButtonLink>
      ) : null}
      {query.result ? (
        <output className="block mt-4 text-ink">
          {t(query.result === "ok" ? "success" : "failure")}
        </output>
      ) : null}
      {!comps.ok ? (
        <AdminDenied />
      ) : comps.value.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <>
          <form
            className="mt-6 space-y-3 max-w-lg"
            action={ADMIN_ARTWORK}
            method="get"
            aria-label={t("competition")}
          >
            <label htmlFor="competition">{t("competition")}</label>
            <select
              id="competition"
              name="competition"
              defaultValue={chosen?.id}
              className={field}
            >
              {comps.value.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.code}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonStyles()}>
              {t("choose")}
            </button>
          </form>
          {chosen && loaded?.ok ? (
            <>
              <section className="mt-10">
                <h2 className="text-h3 text-ink">{t("candidates")}</h2>
                {loaded.value[1].mayRequest &&
                chosen.rule !== "not_required" &&
                loaded.value[1].entries.length > 0 ? (
                  <form
                    aria-label={t("request")}
                    action={requestArtworks.bind(null, chosen.id)}
                    className="mt-4 space-y-4 max-w-2xl"
                  >
                    <fieldset className="space-y-2">
                      <legend className="font-semibold">{t("selected")}</legend>
                      {loaded.value[1].entries.map((e) => (
                        <label key={e.id} className="flex gap-2 items-center">
                          <input type="checkbox" name="entry" value={e.id} />
                          <span>
                            {e.code} · {e.title}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    <label htmlFor="packaging">
                      {t("packaging")} ({t("required")})
                    </label>
                    <textarea
                      id="packaging"
                      name="packaging"
                      required
                      maxLength={2000}
                      className={field}
                      defaultValue={
                        loaded.value[1].settings.packagingInstructions
                      }
                    />
                    <fieldset>
                      <legend className="font-semibold">{t("shipping")}</legend>
                      {(["sender", "foa"] as const).map((p) => (
                        <label key={p} className="flex gap-2">
                          <input
                            type="radio"
                            name="payer"
                            value={p}
                            defaultChecked={
                              loaded.value[1].settings.shippingPayer === p
                            }
                          />
                          {t(p)}
                        </label>
                      ))}
                    </fieldset>
                    <p>
                      {t("address")}: {loaded.value[1].settings.facilityAddress}
                    </p>
                    <button type="submit" className={buttonStyles()}>
                      {t("request")}
                    </button>
                  </form>
                ) : (
                  <p className="mt-3">{t("emptyCandidates")}</p>
                )}
              </section>
              <section className="mt-10">
                <h2 className="text-h3">{t("records")}</h2>
                <search>
                  <form
                    method="get"
                    action={ADMIN_ARTWORK}
                    className="max-w-lg mt-3 space-y-2"
                    aria-label={t("filter")}
                  >
                    <input type="hidden" name="competition" value={chosen.id} />
                    <label htmlFor="q">{t("search")}</label>
                    <input
                      id="q"
                      name="q"
                      type="search"
                      className={field}
                      defaultValue={typeof query.q === "string" ? query.q : ""}
                    />
                    <button type="submit" className={buttonStyles()}>
                      {t("filter")}
                    </button>
                  </form>
                </search>
                {loaded.value[0].ok && loaded.value[0].artworks.length > 0 ? (
                  <ul className="mt-5 grid gap-4 sm:grid-cols-2">
                    {loaded.value[0].artworks.map((work) => (
                      <li
                        className="rounded-3xl border-2 border-border bg-surface p-5 text-ink"
                        key={work.artworkId}
                      >
                        <h3 className="text-h4">{work.artworkCode}</h3>
                        <p>
                          {work.entryTitle} · {t(`status.${work.status}`)}
                        </p>
                        <ButtonLink
                          className="mt-3"
                          href={adminArtworkPath(work.artworkCode)}
                        >
                          {t("details", { code: work.artworkCode })}
                        </ButtonLink>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3">{t("empty")}</p>
                )}
              </section>
            </>
          ) : null}
        </>
      )}
    </Section>
  );
}
