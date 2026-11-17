// TODO(auth): Admin routes are UNPROTECTED. Anyone can view and create
// animals. Add authentication + an authorization check in every admin
// loader/action (e.g. require a Staff/Admin user) before deploying.
import { Plus } from "lucide-react";
import { Link } from "react-router";
import type { Route } from "./+types/admin.animals._index";
import { AdminBanner } from "~/components/admin-banner";
import { formatAge, StatusBadge } from "~/components/animal-card";
import { Button } from "~/components/ui/button";
import { SITE } from "~/lib/site";
import { listAnimals } from "~/services/animalService";

export function meta({}: Route.MetaArgs) {
  return [{ title: `Admin · Animals | ${SITE.name}` }];
}

export async function loader() {
  return { animals: await listAnimals() };
}

export default function AdminAnimals({ loaderData }: Route.ComponentProps) {
  const { animals } = loaderData;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <AdminBanner />
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Animals</h1>
        <Button asChild>
          <Link to="/admin/animals/new">
            <Plus className="mr-1 size-4" /> New animal
          </Link>
        </Button>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Species</th>
              <th className="px-4 py-2 font-medium">Age</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Added</th>
            </tr>
          </thead>
          <tbody>
            {animals.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-4 py-2 font-medium">
                  <Link to={`/animals/${a.id}`} className="hover:underline">
                    {a.name}
                  </Link>
                </td>
                <td className="px-4 py-2 capitalize">{a.species}</td>
                <td className="px-4 py-2">{formatAge(a.ageMonths) ?? "—"}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={a.status} />
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {a.createdAt.toISOString().slice(0, 10)}
                </td>
              </tr>
            ))}
            {animals.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No animals yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
