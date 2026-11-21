/**
 * The browser side of analytics, run by the root layout's island
 * (src/components/analytics/umami-tracker.tsx) on every page it shows.
 *
 * Keep this file free of Next.js, `@/` and server-only imports, like
 * ./umami.ts.
 */

import {
  BEFORE_SEND_GLOBAL,
  type AnalyticsGuard,
  type MarkerStorage,
  type UmamiConfig,
} from "./umami";

/** The parts of `window` the island reads and writes. */
export type AnalyticsWindow = {
  location: { pathname: string };
  /** Reading it throws where the browser blocks storage. */
  readonly localStorage: MarkerStorage;
  readonly navigator: {
    readonly doNotTrack: string | null;
    readonly globalPrivacyControl?: boolean;
  };
  /** The tracker's `data-before-send` handler, once installed. */
  [BEFORE_SEND_GLOBAL]?: AnalyticsGuard["beforeSend"];
};

/** The tracker <script> to append: its src and data-* attributes. */
export type TrackerTag = { src: string; dataset: Record<string, string> };

/**
 * Runs the page checks for the page `win` shows now. Returns the tracker
 * tag to inject the first time a page may load it, else null.
 */
export function startAnalytics(
  _win: AnalyticsWindow,
  _config: UmamiConfig,
  _now: number
): TrackerTag | null {
  return null;
}
