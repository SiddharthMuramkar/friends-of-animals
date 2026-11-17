import { PawPrint } from "lucide-react";
import { Link } from "react-router";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { AnimalStatus } from "~/db/enums";
import { cn } from "~/lib/utils";

const STATUS_STYLES: Record<AnimalStatus, string> = {
  [AnimalStatus.Available]:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  [AnimalStatus.Pending]:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  [AnimalStatus.Adopted]: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: AnimalStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[status],
      )}
    >
      {status}
    </span>
  );
}

export function formatAge(months: number | null | undefined) {
  if (months == null) return null;
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  return `${years} yr${years === 1 ? "" : "s"}`;
}

export function AnimalPhoto({
  url,
  alt,
  className,
}: {
  url: string | null;
  alt: string;
  className?: string;
}) {
  if (url) {
    return <img src={url} alt={alt} className={cn("object-cover", className)} />;
  }
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-muted text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      <PawPrint className="size-10" />
    </div>
  );
}

type CardAnimal = {
  id: number;
  name: string;
  species: string;
  breed: string | null;
  ageMonths: number | null;
  status: AnimalStatus;
  photoUrl: string | null;
};

export function AnimalCard({ animal }: { animal: CardAnimal }) {
  const details = [animal.breed ?? animal.species, formatAge(animal.ageMonths)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link to={`/animals/${animal.id}`} className="group">
      <Card className="h-full gap-0 overflow-hidden py-0 transition-shadow group-hover:shadow-md">
        <AnimalPhoto
          url={animal.photoUrl}
          alt={animal.name}
          className="aspect-[4/3] w-full"
        />
        <CardHeader className="flex flex-row items-center justify-between gap-2 pt-4">
          <h3 className="font-semibold group-hover:text-primary">{animal.name}</h3>
          <StatusBadge status={animal.status} />
        </CardHeader>
        <CardContent className="pb-4 pt-1 text-sm capitalize text-muted-foreground">
          {details}
        </CardContent>
      </Card>
    </Link>
  );
}
