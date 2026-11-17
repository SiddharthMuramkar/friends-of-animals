import { Link } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/animals._index";
import { AnimalCard } from "~/components/animal-card";
import { AnimalStatus } from "~/db/enums";
import { withPhotoUrl } from "~/lib/animal-photo.server";
import { SITE } from "~/lib/site";
import { cn } from "~/lib/utils";
import { listAnimals } from "~/services/animalService";

export function meta({}: Route.MetaArgs) {
  return [{ title: `Adopt | ${SITE.name}` }];
}

const statusSchema = z.nativeEnum(AnimalStatus).optional().catch(undefined);

export async function loader({ request }: Route.LoaderArgs) {
  const status = statusSchema.parse(
    new URL(request.url).searchParams.get("status") ?? undefined,
  );
  const animals = await listAnimals({ status });
  return { animals: animals.map(withPhotoUrl), status: status ?? null };
}

const FILTERS = [
  { label: "All", value: null },
  ...Object.values(AnimalStatus).map((s) => ({ label: s, value: s })),
];

export default function Animals({ loaderData }: Route.ComponentProps) {
  const { animals, status } = loaderData;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Adoptable animals</h1>

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            to={f.value ? `?status=${f.value}` : "."}
            className={cn(
              "rounded-full border px-3 py-1 text-sm capitalize transition-colors",
              status === f.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {animals.length === 0 ? (
        <p className="mt-10 text-muted-foreground">No animals to show right now.</p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {animals.map((animal) => (
            <AnimalCard key={animal.id} animal={animal} />
          ))}
        </div>
      )}
    </div>
  );
}
