import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AdoptionPhoto, ageWords } from "@/components/adoption/adoption-photo";
import { ButtonLink } from "@/components/site/button-link";
import { Callout } from "@/components/site/callout";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import {
  ADOPTION_STORIES_PATH,
  adoptableAnimalPath,
  applyToAdoptPath,
  publicListingPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import type { AdoptableAnimal } from "@/server/modules/adoption";
import { indianStateName as stateName } from "@/server/modules/adoption/domain/details";

import { adoptableAnimal, PLACEHOLDER_SLUG } from "../_lib/public-reads";

// Animals live in the database, which the build can't reach, so the build
// prerenders only this route's App Shell (and the placeholder). Later
// visits get the cached page, which a representative's change refreshes
// through the animal's tag. src/proxy.ts answers any slug without a public
// page with a 404 before any of this runs.

export function generateStaticParams() {
  return [{ slug: PLACEHOLDER_SLUG }];
}

export async function generateMetadata({
  params,
}: PageProps<"/adopt/[slug]">): Promise<Metadata> {
  const animal = await adoptableAnimal((await params).slug);
  if (!animal) return {};
  return pageMetadata({
    title: animal.name,
    description: (animal.about ?? animal.conditions).slice(0, 160),
    path: adoptableAnimalPath(animal.slug),
  });
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm font-semibold text-ink-muted">{label}</dt>
      <dd className="text-ink wrap-anywhere">{children}</dd>
    </div>
  );
}

function Notes({ text, empty }: { text: string | null; empty: string }) {
  return (
    <p className="mt-3 text-ink whitespace-pre-line wrap-anywhere">
      {text ?? empty}
    </p>
  );
}

async function AnimalView({ animal }: { animal: AdoptableAnimal }) {
  const [t, species, sex, size, sterilised, ageParts] = await Promise.all([
    getTranslations("adoption.animal"),
    getTranslations("adoption.species"),
    getTranslations("adoption.sex"),
    getTranslations("adoption.size"),
    getTranslations("adoption.sterilised"),
    getTranslations("adoption.ageParts"),
  ]);
  const [cover, ...more] = animal.photos;
  const empty = t("noNotes");
  return (
    <div className="flex flex-col gap-8">
      <ButtonLink
        href={ROUTES.adopt.path}
        variant="quiet"
        className="-ms-5 self-start"
      >
        {t("back")}
      </ButtonLink>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={animal.name}
        className="wrap-anywhere"
      />
      {animal.status !== "published" ? (
        <Callout tone="info">
          <p>{animal.status === "on_hold" ? t("onHold") : t("adopted")}</p>
        </Callout>
      ) : null}
      {cover ? (
        <AdoptionPhoto
          photo={cover}
          eager
          sizes="(min-width: 768px) 720px, 92vw"
          className="rounded-3xl"
        />
      ) : null}

      <section aria-labelledby="animal-facts" className={CARD}>
        <SectionHeading id="animal-facts" title={t("factsTitle")} />
        <dl className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Fact label={t("species")}>{species(animal.species)}</Fact>
          {animal.breed ? <Fact label={t("breed")}>{animal.breed}</Fact> : null}
          <Fact label={t("sex")}>{sex(animal.sex)}</Fact>
          <Fact label={t("age")}>{ageWords(animal.age, ageParts)}</Fact>
          {animal.size ? (
            <Fact label={t("size")}>{size(animal.size)}</Fact>
          ) : null}
          {animal.colour ? (
            <Fact label={t("colour")}>{animal.colour}</Fact>
          ) : null}
          <Fact label={t("sterilised")}>
            {sterilised(
              animal.sterilised === null
                ? "unknown"
                : animal.sterilised
                  ? "yes"
                  : "no"
            )}
          </Fact>
          <Fact label={t("place")}>
            {t("placeValue", {
              city: animal.city,
              state: stateName(animal.state),
              pinCode: animal.pinCode,
            })}
          </Fact>
        </dl>
      </section>

      <section aria-labelledby="animal-about" className={CARD}>
        <SectionHeading
          id="animal-about"
          title={t("aboutTitle", { name: animal.name })}
        />
        <Notes text={animal.about} empty={empty} />
        <h3 className="mt-6 text-lead font-bold text-ink">
          {t("healthTitle")}
        </h3>
        <Notes text={animal.healthNotes} empty={empty} />
        <h3 className="mt-6 text-lead font-bold text-ink">
          {t("vaccinationTitle")}
        </h3>
        <Notes text={animal.vaccinationNotes} empty={empty} />
        <h3 className="mt-6 text-lead font-bold text-ink">
          {t("conditionsTitle")}
        </h3>
        <Notes text={animal.conditions} empty={empty} />
      </section>

      {more.length > 0 ? (
        <section aria-labelledby="animal-photos" className={CARD}>
          <SectionHeading id="animal-photos" title={t("photosTitle")} />
          <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            {more.map((photo) => (
              <li key={photo.id}>
                <AdoptionPhoto
                  photo={photo}
                  sizes="(min-width: 768px) 340px, 92vw"
                  className="rounded-2xl"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {animal.status === "published" ? (
        <section aria-labelledby="animal-apply" className={CARD}>
          <SectionHeading
            id="animal-apply"
            title={t("applyTitle", { name: animal.name })}
          />
          <p className="mt-3 text-ink">
            {t("applyBody", { organisation: animal.organisation.name })}
          </p>
          <p className="mt-4 flex flex-wrap gap-4">
            <ButtonLink href={applyToAdoptPath(animal.slug)}>
              {t("applyLink", { name: animal.name })}
            </ButtonLink>
            <ButtonLink href={ADOPTION_STORIES_PATH} variant="secondary">
              {t("storiesLink")}
            </ButtonLink>
          </p>
        </section>
      ) : null}

      <section aria-labelledby="animal-organisation" className={CARD}>
        <SectionHeading
          id="animal-organisation"
          title={t("organisationTitle")}
        />
        <p className="mt-3 text-ink">
          {t("organisationBody", {
            organisation: animal.organisation.name,
            name: animal.name,
          })}
        </p>
        <p className="mt-3">
          <SiteLink
            href={publicListingPath(animal.organisation.slug)}
            className="inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover wrap-anywhere"
          >
            {t("organisationLink", { organisation: animal.organisation.name })}
          </SiteLink>
        </p>
      </section>
    </div>
  );
}

/** The page for the requested slug; params resolve inside the boundary. */
async function Animal({ params }: PageProps<"/adopt/[slug]">) {
  const animal = await adoptableAnimal((await params).slug);
  if (!animal) notFound();
  return <AnimalView animal={animal} />;
}

export default function Page(props: PageProps<"/adopt/[slug]">) {
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<DetailFallback />}>
        <Animal {...props} />
      </Suspense>
    </Section>
  );
}

/** The App Shell's stand-in for the page while it renders. */
async function DetailFallback() {
  const t = await getTranslations("adoption.animal");
  return (
    <output className="block">
      <span className="sr-only">{t("loading")}</span>
      <span aria-hidden="true" className="grid max-w-xl gap-4">
        <span className="block h-8 w-32 rounded-full bg-surface-muted" />
        <span className="block h-64 rounded-2xl bg-surface-muted" />
        <span className="block h-24 rounded-2xl bg-surface-muted" />
      </span>
    </output>
  );
}
