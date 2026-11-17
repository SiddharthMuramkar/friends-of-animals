import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import type { Route } from "./+types/home";
import { AnimalCard } from "~/components/animal-card";
import { Button } from "~/components/ui/button";
import { AnimalStatus } from "~/db/enums";
import { withPhotoUrl } from "~/lib/animal-photo.server";
import { SITE } from "~/lib/site";
import { listAnimals } from "~/services/animalService";

export function meta({}: Route.MetaArgs) {
  return [
    { title: SITE.name },
    { name: "description", content: SITE.tagline },
  ];
}

export async function loader() {
  const featured = await listAnimals({ status: AnimalStatus.Available, limit: 3 });
  return { featured: featured.map(withPhotoUrl) };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { featured } = loaderData;
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">{SITE.name}</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          {SITE.tagline}
        </p>
        <Button asChild size="lg" className="mt-10">
          <Link to="/animals">
            Meet our animals
            <ArrowRight className="ml-2 size-4" />
          </Link>
        </Button>
      </section>

      {featured.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="mb-8 flex items-end justify-between gap-4">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Looking for a home
            </h2>
            <Link
              to="/animals?status=available"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((animal) => (
              <AnimalCard key={animal.id} animal={animal} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
