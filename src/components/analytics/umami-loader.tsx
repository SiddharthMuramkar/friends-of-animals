"use client";

import dynamic from "next/dynamic";

import type { UmamiConfig } from "@/lib/analytics/umami";

/**
 * The tracker island in a chunk of its own, fetched in the browser only
 * where the server wrapper renders this, so builds without Umami ship
 * just this loader. ssr: false also keeps the island's usePathname out of
 * prerendering.
 */
const UmamiTracker = dynamic(
  () => import("./umami-tracker").then((module) => module.UmamiTracker),
  { ssr: false }
);

export function UmamiLoader({ config }: { config: UmamiConfig }) {
  return <UmamiTracker config={config} />;
}
