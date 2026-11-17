import { ArrowLeft } from "lucide-react";
import { data, Link } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/animals.$id";
import { AnimalPhoto, formatAge, StatusBadge } from "~/components/animal-card";
import { Button } from "~/components/ui/button";
import { AnimalStatus } from "~/db/enums";
import { withPhotoUrl } from "~/lib/animal-photo.server";
import { SITE } from "~/lib/site";
import { parseParams } from "~/lib/validation";
import { getAnimal } from "~/services/animalService";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

export async function loader({ params }: Route.LoaderArgs) {
  const { id } = parseParams(params, paramsSchema);
  const animal = await getAnimal(id);
  if (!animal) throw data(null, { status: 404 });
  return { animal: withPhotoUrl(animal) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.animal.name ?? "Animal";
  return [{ title: `${name} | ${SITE.name}` }];
}

export default function AnimalDetail({ loaderData }: Route.ComponentProps) {
  const { animal } = loaderData;
  const facts = [
    ["Species", animal.species],
    ["Breed", animal.breed],
    ["Age", formatAge(animal.ageMonths)],
    ["Sex", animal.sex],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link
        to="/animals"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All animals
      </Link>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <AnimalPhoto
          url={animal.photoUrl}
          alt={animal.name}
          className="aspect-square w-full rounded-lg"
        />
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{animal.name}</h1>
            <StatusBadge status={animal.status} />
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium capitalize">{value}</dd>
              </div>
            ))}
          </dl>
          {animal.description && (
            <p className="mt-6 whitespace-pre-line leading-relaxed">
              {animal.description}
            </p>
          )}
          {animal.status !== AnimalStatus.Adopted && (
            <Button asChild className="mt-8">
              <a
                href={`mailto:${SITE.contactEmail}?subject=${encodeURIComponent(
                  `Adoption inquiry: ${animal.name}`,
                )}`}
              >
                Ask about {animal.name}
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
