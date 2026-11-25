import { Suspense } from "react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { buttonStyles } from "@/components/site/button-link";
import { as } from "@/server/app";
import { PUBLIC_READER } from "../competitions/_lib/public-reader";
import { ArtworkCards } from "./_artwork";
export async function generateMetadata() {
  const t = await getTranslations("gallery");
  return {
    title: t("title"),
    description: t("lead"),
    robots: { index: false, follow: false },
  };
}
export default async function Page({ searchParams }: PageProps<"/gallery">) {
  const t = await getTranslations("gallery");
  return (
    <Section hue="pink" tone="tint" width="wide" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("lead")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Gallery searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}
async function Gallery({
  searchParams,
}: Pick<PageProps<"/gallery">, "searchParams">) {
  await connection();
  const [query, t] = await Promise.all([
    searchParams,
    getTranslations("gallery"),
  ]);
  const filters = Object.fromEntries(
    ["competition", "discipline", "category", "recognition", "cursor"].flatMap(
      (k) => (typeof query[k] === "string" && query[k] ? [[k, query[k]]] : [])
    )
  );
  const api = as(PUBLIC_READER);
  const page = await api.listPublicGallery(filters);
  const options = Object.keys(filters).length
    ? (await api.listPublicGallery()).items
    : page.items;
  const choices = {
    competition: options.map((item) => [
      item.competition.slug,
      item.competition.name,
    ]),
    discipline: options.map((item) => [item.discipline, item.discipline]),
    category: options.map((item) => [item.category, item.category]),
    recognition: options.map((item) => [
      item.recognition?.value ?? "none",
      item.recognition?.value?.replaceAll("_", " ") ?? t("notAwarded"),
    ]),
  };
  const more = page.nextCursor
    ? new URLSearchParams({ ...filters, cursor: page.nextCursor }).toString()
    : null;
  return (
    <section className="mt-8" aria-labelledby="gallery-stories">
      <h2 id="gallery-stories" className="text-h3 text-ink">
        {t("displayTitle")}
      </h2>
      <details className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <summary className="font-semibold cursor-pointer min-h-11 flex items-center">
          {t("filter")}
        </summary>
        <form
          method="get"
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {(
            [
              ["competition", "competition"],
              ["discipline", "discipline"],
              ["category", "filterCategory"],
              ["recognition", "recognition"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="grid gap-1">
              <label
                htmlFor={`filter-${key}`}
                className="font-semibold text-sm"
              >
                {t(label)}
              </label>
              <select
                id={`filter-${key}`}
                name={key}
                defaultValue={filters[key] ?? ""}
                className="min-h-12 min-w-0 rounded-xl border-2 border-border-strong bg-background px-3 text-ink"
              >
                <option value="">{t("all")}</option>
                {Array.from(
                  new Map(
                    choices[key].map(([value, label]) => [value!, label!])
                  )
                ).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button
            className={buttonStyles({ variant: "secondary" })}
            type="submit"
          >
            {t("filter")}
          </button>
          <a href="/gallery" className={buttonStyles({ variant: "quiet" })}>
            {t("clear")}
          </a>
        </form>
      </details>
      <ArtworkCards items={page.items} />
      {more ? (
        <a
          className={buttonStyles({ variant: "secondary", className: "mt-6" })}
          href={`/gallery?${more}`}
        >
          {t("next")}
        </a>
      ) : null}
    </section>
  );
}
