import { buildEnv } from "@/env";
import { umamiConfig } from "@/lib/analytics/umami";

import { UmamiLoader } from "./umami-loader";

/**
 * Cookieless page views through the self-hosted Umami
 * (src/lib/analytics/umami.ts). Renders the tracker island's loader only
 * on a staging or production build with Umami configured; elsewhere
 * nothing, and the island's own chunk is never fetched.
 */
export function UmamiAnalytics() {
  const env = buildEnv();
  const config = umamiConfig({
    appEnv: env.APP_ENV,
    appUrl: env.APP_URL,
    websiteId: env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
    origin: env.UMAMI_ORIGIN,
  });
  if (config === null) return null;
  return <UmamiLoader config={config} />;
}
