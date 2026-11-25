import { Globe, Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { FormAlert, SelectField, TextField } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { NGO_REGISTER, publicListingPath } from "@/lib/app-routes";
import { formatPhoneNumber, type E164Phone } from "@/lib/phone";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import {
  DEFAULT_RADIUS_KM,
  DIRECTORY_SERVICES,
  RADIUS_OPTIONS_KM,
  SEARCH_RESULT_LIMIT,
  type SearchField,
  type SearchListingsInput,
  type SearchListingsResult,
  type SearchResult,
} from "@/server/modules/directory";
import { LOCATION_DECIMALS } from "@/server/modules/directory/domain/geo";

import { UseMyLocation } from "./_components/use-my-location";
import { searchDirectory } from "./_lib/search";

// The directory search (#128): verified listings by service and distance
// from a pin code or the visitor's location. The form is a plain GET form,
// so it works without JavaScript; "Use my location" is the only island.
// The header and an empty form are the static shell; the query string is
// read behind the Suspense boundary, and each search runs per request.

const PATH = ROUTES.ngos.path;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("directory.search.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: PATH,
  });
}

export default async function Page({ searchParams }: PageProps<"/ngos">) {
  const t = await getTranslations("directory.search");
  return (
    <Section hue="green" tone="tint" width="wide" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense fallback={<SearchForm />}>
        <Search searchParams={searchParams} />
      </Suspense>
      <aside className="mt-10 max-w-3xl rounded-3xl border-2 border-dashed border-border-strong bg-surface p-5 text-ink sm:p-6">
        <p>{t("disclaimer")}</p>
        <p className="mt-3">{t("register")}</p>
        <p className="mt-2">
          <SiteLink href={NGO_REGISTER} className={LINK}>
            {t("registerLink")}
          </SiteLink>
        </p>
      </aside>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const LINK =
  "inline-flex min-h-11 items-center gap-2 font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover wrap-anywhere";

const FIELDS = ["pin", "lat", "lng", "service", "radius"] as const;

/** The query string's search fields; null when nothing was searched. */
function searchFrom(
  query: Record<string, string | string[] | undefined>
): SearchListingsInput | null {
  const input: SearchListingsInput = {};
  for (const field of FIELDS) {
    const value = query[field];
    if (value !== undefined) input[field] = value;
  }
  return Object.keys(input).length > 0 ? input : null;
}

const single = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : "";

async function Search({
  searchParams,
}: {
  searchParams: PageProps<"/ngos">["searchParams"];
}) {
  const query = await searchParams;
  const input = searchFrom(query);
  if (!input) return <SearchForm />;
  const result = await searchDirectory(input);
  const values = {
    pin: single(input.pin),
    service: result.ok ? (result.service ?? "") : single(input.service),
    radius: result.ok ? String(result.radiusKm) : single(input.radius),
  };
  return (
    <>
      <SearchForm values={values} result={result} />
      {result.ok ? <Results result={result} /> : null}
    </>
  );
}

type FormValues = { pin: string; service: string; radius: string };

async function SearchForm({
  values = { pin: "", service: "", radius: String(DEFAULT_RADIUS_KM) },
  result,
}: {
  values?: FormValues;
  result?: SearchListingsResult;
}) {
  const [t, services] = await Promise.all([
    getTranslations("directory.search"),
    getTranslations("directory.services"),
  ]);
  const problems: Partial<Record<SearchField, string>> = {};
  if (result && !result.ok) {
    if (result.error === "unknown_pin_code") {
      problems.pin = t("errors.pin.unknown");
    } else {
      for (const [field, problem] of Object.entries(result.problems)) {
        problems[field as SearchField] = t(
          `errors.${field as SearchField}.${problem}` as Parameters<typeof t>[0]
        );
      }
    }
  }
  const radius = values.radius || String(DEFAULT_RADIUS_KM);
  const point =
    result?.ok && result.origin.kind === "point" ? result.origin : null;
  return (
    // Block: before Safari 17 <search> is an unknown, inline element.
    <search aria-labelledby="directory-search" className={`mt-8 block ${CARD}`}>
      <SectionHeading id="directory-search" title={t("form.title")} />
      {problems.location ? (
        <FormAlert tone="danger" label={t("errors.title")} className="mt-4">
          {problems.location}
        </FormAlert>
      ) : null}
      <form method="get" action={PATH} className="mt-5 flex flex-col gap-5">
        {point ? (
          <>
            {/* Keep the validated, coarsened point when refining filters.
                A typed pin code takes precedence in the search parser. */}
            <input
              type="hidden"
              name="lat"
              value={point.latitude.toFixed(LOCATION_DECIMALS)}
            />
            <input
              type="hidden"
              name="lng"
              value={point.longitude.toFixed(LOCATION_DECIMALS)}
            />
            <p className="text-sm text-ink-muted">{t("form.locationActive")}</p>
          </>
        ) : null}
        <div className="grid gap-5 md:grid-cols-3">
          <TextField
            id="search-pin"
            name="pin"
            label={t("form.pin")}
            hint={t("form.pinHint")}
            error={problems.pin}
            defaultValue={values.pin}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={7}
          />
          <SelectField
            id="search-service"
            name="service"
            label={t("form.service")}
            placeholder={t("form.anyService")}
            error={problems.service}
            defaultValue={values.service}
            options={DIRECTORY_SERVICES.map((service) => ({
              value: service,
              label: services(service),
            }))}
          />
          <div className="flex flex-col gap-2">
            <label htmlFor="search-radius" className="font-semibold text-ink">
              {t("form.radius")}
            </label>
            {problems.radius ? (
              <p id="search-radius-error" className="font-semibold text-danger">
                {problems.radius}
              </p>
            ) : null}
            <select
              id="search-radius"
              name="radius"
              defaultValue={radius}
              aria-describedby={
                problems.radius ? "search-radius-error" : undefined
              }
              aria-invalid={problems.radius ? true : undefined}
              className="block min-h-11 w-full rounded-2xl border-2 border-border-strong bg-surface px-4 py-2 text-body text-ink"
            >
              {RADIUS_OPTIONS_KM.map((km) => (
                <option key={km} value={String(km)}>
                  {t("form.radius_option", { km })}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <button type="submit" className={buttonStyles()}>
            {t("form.submit")}
          </button>
          <div className="flex max-w-md flex-col gap-2">
            <p className="text-ink">{t("form.or")}</p>
            <UseMyLocation
              path={PATH}
              labels={{
                useLocation: t("form.useLocation"),
                locating: t("form.locating"),
                denied: t("form.locationDenied"),
                unavailable: t("form.locationUnavailable"),
                privacy: t("form.locationPrivacy"),
              }}
            />
          </div>
        </div>
      </form>
    </search>
  );
}

async function Results({
  result,
}: {
  result: Extract<SearchListingsResult, { ok: true }>;
}) {
  const [t, services] = await Promise.all([
    getTranslations("directory.search"),
    getTranslations("directory.services"),
  ]);
  const { origin, results } = result;
  const count = results.length;
  const summary =
    origin.kind === "pin"
      ? t("results.fromPin", {
          count,
          km: result.radiusKm,
          pinCode: origin.pinCode,
          district: origin.district ?? "none",
        })
      : t("results.fromPoint", { count, km: result.radiusKm });
  return (
    <section aria-labelledby="directory-results" className="mt-10">
      <SectionHeading id="directory-results" title={t("results.title")} />
      <p className="mt-3 text-lead text-ink">
        {summary}
        {result.service ? (
          <>
            {" "}
            <span className="text-ink-muted">
              {t("results.forService", {
                service: services(result.service),
              })}
            </span>
          </>
        ) : null}
      </p>
      {count === 0 ? (
        <p className="mt-3 text-ink">{t("results.empty")}</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-muted">
            {t("results.approximate")}
          </p>
          <ol className="mt-6 grid gap-5 lg:grid-cols-2">
            {results.map((found) => (
              <li key={found.listing.slug}>
                <ResultCard found={found} />
              </li>
            ))}
          </ol>
          {result.truncated ? (
            <p className="mt-6 text-ink">
              {t("results.truncated", { limit: SEARCH_RESULT_LIMIT })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

async function ResultCard({ found }: { found: SearchResult }) {
  const [t, types, services] = await Promise.all([
    getTranslations("directory.search.results"),
    getTranslations("directory.type"),
    getTranslations("directory.services"),
  ]);
  const { listing, distance } = found;
  const { contact } = listing;
  const hasContact = Boolean(contact.phone ?? contact.email ?? contact.website);
  const headingId = `result-${listing.slug}`;
  return (
    <article aria-labelledby={headingId} className={`${CARD} h-full`}>
      <p className="flex flex-wrap items-center gap-2">
        <Chip tone="green" icon={<MapPin aria-hidden="true" />}>
          {distance.kind === "under"
            ? t("distance_under")
            : t("distance_about", { km: distance.km })}
        </Chip>
        <Chip>{types(listing.type)}</Chip>
      </p>
      <h3 id={headingId} className="mt-4 text-lead font-bold text-ink">
        <SiteLink href={publicListingPath(listing.slug)} className={LINK}>
          {listing.name}
        </SiteLink>
      </h3>
      <p className="mt-1 text-ink-muted">
        {t("place", {
          city: listing.city,
          state: listing.state,
          pinCode: listing.pinCode,
        })}
      </p>
      <h4 className="mt-4 font-semibold text-ink">{t("services")}</h4>
      <ul className="mt-2 flex flex-wrap gap-2">
        {listing.services.map((service) => (
          <li key={service}>
            <Chip tone="blue">{services(service)}</Chip>
          </li>
        ))}
      </ul>
      <h4 className="mt-4 font-semibold text-ink">{t("contact")}</h4>
      {hasContact ? (
        <ul className="mt-1 flex flex-col">
          {contact.phone ? (
            <li>
              <a href={`tel:${contact.phone}`} className={LINK}>
                <Phone aria-hidden="true" className="size-5" />
                {formatPhoneNumber(contact.phone as E164Phone)}
              </a>
            </li>
          ) : null}
          {contact.email ? (
            <li>
              <a href={`mailto:${contact.email}`} className={LINK}>
                <Mail aria-hidden="true" className="size-5" />
                {contact.email}
              </a>
            </li>
          ) : null}
          {contact.website ? (
            <li>
              <a
                href={contact.website}
                rel="nofollow noopener noreferrer"
                className={LINK}
              >
                <Globe aria-hidden="true" className="size-5" />
                {new URL(contact.website).host}
              </a>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="mt-1 text-ink">{t("noContact")}</p>
      )}
    </article>
  );
}
