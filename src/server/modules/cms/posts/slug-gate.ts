// Which post slugs the proxy lets through to /blog/[slug]. The proxy runs
// before rendering on every request, and `use cache` has no effect there,
// so the gate keeps the published slugs in memory and reads them again at
// most once per `ttlMs`. A post published since shows up within that time.
//
// If the source fails, the gate keeps the slugs it read last. If it has
// never read any, it lets every slug through: the page then renders its own
// not-found for a slug that isn't public (with a 200 status, which beats
// hiding every post while the database is down).

export type SlugGate = { has(slug: string): Promise<boolean> };

export function createSlugGate({
  load,
  ttlMs,
  now = Date.now,
}: {
  load: () => Promise<readonly string[]>;
  ttlMs: number;
  now?: () => number;
}): SlugGate {
  let slugs: ReadonlySet<string> | null = null;
  let readAt = Number.NEGATIVE_INFINITY;
  let reading: Promise<void> | null = null;

  async function refresh() {
    const startedAt = now();
    try {
      slugs = new Set(await load());
    } catch {
      // Keep what we had; try again once the time is up.
    } finally {
      readAt = startedAt;
      reading = null;
    }
  }

  return {
    async has(slug) {
      if (now() - readAt >= ttlMs) {
        reading ??= refresh();
        await reading;
      }
      return slugs === null || slugs.has(slug);
    },
  };
}
