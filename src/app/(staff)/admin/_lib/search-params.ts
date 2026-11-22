/** A page's search params, as Next passes them. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** The first value of a search param, trimmed, if it has a non-empty one. */
export function firstParam(
  searchParams: SearchParams,
  name: string
): string | undefined {
  const raw = searchParams[name];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value ? value : undefined;
}
