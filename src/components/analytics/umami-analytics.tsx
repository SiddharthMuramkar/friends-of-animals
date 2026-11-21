import { Suspense } from "react";

import { buildEnv } from "@/env";
import { umamiConfig } from "@/lib/analytics/umami";

import { UmamiTracker } from "./umami-tracker";

/**
 * Cookieless page views through the self-hosted Umami
 * (src/lib/analytics/umami.ts). Renders the tracker island only on a
 * staging or production build with Umami configured; elsewhere nothing,
 * so local runs and previews ship no analytics code at all.
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
  return (
    // The island's usePathname suspends while a page with a param that
    // isn't known at build time is prerendered; the island shows nothing.
    <Suspense fallback={null}>
      <UmamiTracker config={config} />
    </Suspense>
  );
}
