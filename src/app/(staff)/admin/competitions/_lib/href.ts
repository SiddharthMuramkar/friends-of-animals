import { APP_ROUTES } from "@/lib/app-routes";

/** A competition's edit or preview page, with any query parameters. */
export function competitionHref(
  competitionId: string,
  page: "edit" | "preview",
  query: Record<string, string> = {}
): string {
  const path = `${APP_ROUTES.adminCompetitions}/${encodeURIComponent(competitionId)}/${page}`;
  const search = new URLSearchParams(query).toString();
  return search ? `${path}?${search}` : path;
}
