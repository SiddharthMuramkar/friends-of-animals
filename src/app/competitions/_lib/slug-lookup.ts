/** Answers whether a published competition has this slug. */
export type SlugLookup = (slug: string) => Promise<boolean>;

/**
 * A slug lookup for src/proxy.ts that keeps the published slugs in memory,
 * so a visit doesn't cost a database query:
 *
 * - A known slug is answered from memory for `ttlMs`.
 * - An unknown one reloads the list, so a competition published a moment
 *   ago shows straight away, but at most once per `missRefreshMs`: a run
 *   of made-up slugs can't turn into a query each.
 * - Requests that arrive together share one load. A failed load rejects
 *   and the next request tries again.
 */
export function memoisedSlugLookup({
  load,
  now,
  ttlMs,
  missRefreshMs,
}: {
  load: () => Promise<readonly string[]>;
  now: () => number;
  ttlMs: number;
  missRefreshMs: number;
}): SlugLookup {
  let slugs: ReadonlySet<string> | undefined;
  // When the load behind `slugs` started: the list is at least this fresh.
  let loadedAt = Number.NEGATIVE_INFINITY;
  let loading: Promise<ReadonlySet<string>> | undefined;

  const reload = () => {
    loading ??= (async () => {
      const startedAt = now();
      try {
        const list = new Set(await load());
        slugs = list;
        loadedAt = startedAt;
        return list;
      } finally {
        loading = undefined;
      }
    })();
    return loading;
  };

  return async (slug) => {
    const age = now() - loadedAt;
    if (slugs?.has(slug) && age < ttlMs) return true;
    if (slugs && age < missRefreshMs) return false;
    return (await reload()).has(slug);
  };
}
