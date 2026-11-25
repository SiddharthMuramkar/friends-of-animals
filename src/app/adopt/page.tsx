import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Illustration } from "@/components/art/illustration";
import { buttonStyles, ButtonLink } from "@/components/site/button-link";
import { inputStyles } from "@/components/form/text-field";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ADOPTION_STORIES_PATH } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { ADOPTION_AGE_BANDS } from "@/server/modules/adoption/domain/age";
import {
  ADOPTION_SPECIES,
  ANIMAL_SIZES,
  INDIAN_STATES,
} from "@/server/modules/adoption/domain/details";
import {
  filtersToSearchParams,
  parseAdoptionFilters,
  type AdoptionFilters,
} from "@/server/modules/adoption/domain/filters";

import { AnimalCard } from "./_components/animal-card";
import { browsePage } from "./_lib/public-reads";

const HUE = ROUTES.adopt.hue;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adoption.browse.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.adopt.path,
  });
}

// A static shell (the header) with the filters and results streamed in:
// both read the query string, which only a request has. The results come
// from a cached read keyed on the canonical filters, so every visitor
// asking the same question shares one database query.
export default async function Page({ searchParams }: PageProps<"/adopt">) {
  const t = await getTranslations("adoption.browse");
  return (
    <Section hue={HUE} tone="tint" className="pt-10 sm:pt-14">
      <div className="flex flex-wrap items-end gap-3">
        <PageHeader
          eyebrow={t("eyebrow")}
          tile={HUE}
          title={t("title")}
          lead={t("lead")}
          className="min-w-0 flex-[1_1_16rem]"
        />
        <Illustration
          id="sticker-adoption-friends"
          sizes="(min-width: 640px) 112px, 88px"
          decorative
          className="pointer-events-none ms-auto w-[88px] max-w-full shrink-0 sm:w-[112px]"
        />
      </div>
      <div className="mt-5">
        <ButtonLink href={ADOPTION_STORIES_PATH} variant="secondary">
          {t("storiesLink")}
        </ButtonLink>
      </div>
      <Suspense fallback={<ResultsFallback label={t("loading")} />}>
        <Browse searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const LABEL = "font-semibold text-ink";

async function Filters({ filters }: { filters: AdoptionFilters }) {
  const [t, species, sex, size, ageBand] = await Promise.all([
    getTranslations("adoption.browse.filters"),
    getTranslations("adoption.species"),
    getTranslations("adoption.sex"),
    getTranslations("adoption.size"),
    getTranslations("adoption.ageBand"),
  ]);
  const select = (
    name: keyof AdoptionFilters,
    label: string,
    options: { value: string; label: string }[]
  ) => (
    <div className="flex flex-col gap-2">
      <label htmlFor={`filter-${name}`} className={LABEL}>
        {label}
      </label>
      <select
        id={`filter-${name}`}
        name={name}
        defaultValue={String(filters[name] ?? "")}
        className={inputStyles}
      >
        <option value="">{t("any")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    // A plain GET form: the filters live in the URL, work without
    // JavaScript, and a filtered list can be shared.
    <form
      method="get"
      aria-labelledby="filters-title"
      className="mt-8 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6"
    >
      <h2 id="filters-title" className="text-h4 leading-tight text-ink">
        {t("title")}
      </h2>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {select(
          "species",
          t("species"),
          ADOPTION_SPECIES.map((value) => ({ value, label: species(value) }))
        )}
        {select(
          "age",
          t("age"),
          ADOPTION_AGE_BANDS.map((value) => ({ value, label: ageBand(value) }))
        )}
        {select(
          "sex",
          t("sex"),
          (["female", "male"] as const).map((value) => ({
            value,
            label: sex(value),
          }))
        )}
        {select(
          "size",
          t("size"),
          ANIMAL_SIZES.map((value) => ({ value, label: size(value) }))
        )}
        {select(
          "state",
          t("state"),
          INDIAN_STATES.map((state) => ({
            value: state.key,
            label: state.name,
          }))
        )}
        <div className="flex flex-col gap-2">
          <label htmlFor="filter-city" className={LABEL}>
            {t("city")}
          </label>
          <input
            id="filter-city"
            name="city"
            defaultValue={filters.city ?? ""}
            maxLength={80}
            autoComplete="address-level2"
            className={inputStyles}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="filter-pin" className={LABEL}>
            {t("pin")}
          </label>
          <input
            id="filter-pin"
            name="pin"
            defaultValue={filters.pin ?? ""}
            inputMode="numeric"
            maxLength={6}
            autoComplete="postal-code"
            className={inputStyles}
          />
        </div>
        <label className="flex min-h-11 items-center gap-3 self-end text-ink">
          <input
            type="checkbox"
            name="sterilised"
            value="yes"
            defaultChecked={filters.sterilised === true}
            className="size-5 shrink-0 accent-link"
          />
          {t("sterilised")}
        </label>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonStyles()}>
          {t("apply")}
        </button>
        <ButtonLink href={ROUTES.adopt.path} variant="quiet">
          {t("clear")}
        </ButtonLink>
      </div>
    </form>
  );
}

async function Browse({
  searchParams,
}: Pick<PageProps<"/adopt">, "searchParams">) {
  const params = await searchParams;
  const filters = parseAdoptionFilters(params);
  const query = filtersToSearchParams(filters);
  const after = typeof params.after === "string" ? params.after : null;
  const [t, page] = await Promise.all([
    getTranslations("adoption.browse"),
    browsePage(query, after),
  ]);
  const next = page.nextCursor
    ? `${ROUTES.adopt.path}?${new URLSearchParams([
        ...new URLSearchParams(query),
        ["after", page.nextCursor],
      ]).toString()}`
    : null;
  return (
    <>
      <Filters filters={filters} />
      <section aria-labelledby="results-title" className="mt-10">
        <h2 id="results-title" className="text-h3 text-(--section-heading)">
          {t("results")}
        </h2>
        <output className="mt-2 block text-ink-muted">
          {t("count", { count: page.animals.length })}
        </output>
        {page.animals.length === 0 ? (
          <p className="mt-6 max-w-prose text-lead text-ink">{t("empty")}</p>
        ) : (
          <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {page.animals.map((animal) => (
              <li key={animal.slug} className="flex">
                <AnimalCard animal={animal} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          {after ? (
            <ButtonLink
              href={query ? `${ROUTES.adopt.path}?${query}` : ROUTES.adopt.path}
              variant="secondary"
            >
              {t("first")}
            </ButtonLink>
          ) : null}
          {next ? (
            <ButtonLink href={next} variant="secondary">
              {t("next")}
            </ButtonLink>
          ) : null}
        </div>
      </section>
    </>
  );
}

function ResultsFallback({ label }: { label: string }) {
  return (
    <output className="mt-8 block">
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="grid gap-4 sm:grid-cols-3">
        <span className="block h-64 rounded-3xl bg-surface-muted" />
        <span className="block h-64 rounded-3xl bg-surface-muted" />
        <span className="block h-64 rounded-3xl bg-surface-muted" />
      </span>
    </output>
  );
}
