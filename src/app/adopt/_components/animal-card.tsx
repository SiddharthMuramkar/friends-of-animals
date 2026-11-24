import { MapPin, PawPrint } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { AdoptionPhoto, ageWords } from "@/components/adoption/adoption-photo";
import { Chip } from "@/components/site/chip";
import { SiteLink } from "@/components/site/site-link";
import { adoptableAnimalPath } from "@/lib/app-routes";
import type { AdoptableAnimalCard } from "@/server/modules/adoption";
import { indianStateName as stateName } from "@/server/modules/adoption/domain/details";

/** One adoptable animal in the browse grid; the whole card is its link. */
export async function AnimalCard({ animal }: { animal: AdoptableAnimalCard }) {
  const [t, species, sex, ageParts] = await Promise.all([
    getTranslations("adoption.browse"),
    getTranslations("adoption.species"),
    getTranslations("adoption.sex"),
    getTranslations("adoption.ageParts"),
  ]);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl border-2 border-border bg-surface shadow-warm transition-[translate,border-color] duration-200 ease-out hover:border-border-strong has-[a:focus-visible]:border-border-strong motion-safe:hover:-translate-y-0.5">
      <div className="aspect-4/3 overflow-hidden bg-surface-muted">
        {animal.cover ? (
          <AdoptionPhoto
            photo={animal.cover}
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 45vw, 92vw"
            className="aspect-4/3"
          />
        ) : (
          <p className="flex h-full items-center justify-center gap-2 text-ink-muted">
            <PawPrint aria-hidden="true" className="size-6" />
            {t("noPhoto")}
          </p>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 className="text-h4 leading-tight text-ink wrap-anywhere">
          <SiteLink
            href={adoptableAnimalPath(animal.slug)}
            className="rounded-sm decoration-2 underline-offset-4 group-hover:underline after:absolute after:inset-0 after:rounded-3xl after:content-['']"
          >
            {animal.name}
          </SiteLink>
        </h3>
        <p className="flex flex-wrap gap-2">
          <Chip tone="green">{species(animal.species)}</Chip>
          <Chip>{sex(animal.sex)}</Chip>
          <Chip>{ageWords(animal.age, ageParts)}</Chip>
        </p>
        <p className="mt-auto flex items-center gap-2 text-ink-muted">
          <MapPin aria-hidden="true" className="size-4 shrink-0" />
          {t("place", { city: animal.city, state: stateName(animal.state) })}
        </p>
        <p className="text-sm text-ink-muted wrap-anywhere">
          {t("from", { organisation: animal.organisation.name })}
        </p>
      </div>
    </article>
  );
}
