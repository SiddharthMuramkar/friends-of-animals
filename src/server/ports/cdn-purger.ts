/** Purge same-origin public paths; no storage locators or child credits. */
export interface CdnPurger {
  purge(paths: readonly string[]): Promise<void>;
}
/** The gallery uses live private streams with no-store; no CDN cache exists
 * by construction unless the owner explicitly enables a cache provider. */
export const noStoreCdnPurger: CdnPurger = {
  purge: async (paths) => {
    publicPurgePaths(paths);
  },
};

/** Check the entire request before any provider call. Return canonical public
 * paths, as the provider receives them, with no fragment or other origin. */
export function publicPurgePaths(paths: readonly string[]) {
  const origin = new URL("https://cdn-path.test");
  return paths.map((path) => {
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("\\") ||
      /[\x00-\x20\x7f]/.test(path)
    )
      throw new Error("Invalid public route");
    const url = new URL(path, origin);
    if (url.origin !== origin.origin || url.hash)
      throw new Error("Invalid public route");
    return url.pathname + url.search;
  });
}

/** Opt-in adapter, deliberately not wired to any production credentials. */
export function cloudflareCdnPurger(
  config: { origin: string; zoneId: string; token: string },
  send: typeof fetch = fetch
): CdnPurger {
  const origin = new URL(config.origin);
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !/^[a-f0-9]{32}$/i.test(config.zoneId)
  )
    throw new Error("Invalid CDN configuration");
  return {
    async purge(paths) {
      const urls = publicPurgePaths(paths).map(
        (path) => new URL(path, origin).href
      );
      for (let i = 0; i < urls.length; i += 30) {
        const response = await send(
          `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/purge_cache`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ files: urls.slice(i, i + 30) }),
          }
        );
        if (
          !response.ok ||
          !((await response.json()) as { success?: boolean }).success
        )
          throw new Error("CDN purge not confirmed");
      }
    },
  };
}
