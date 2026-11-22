/**
 * The browser side of analytics, run by the root layout's island
 * (src/components/analytics/umami-tracker.tsx) on every page it shows.
 *
 * Keep this file free of Next.js, `@/` and server-only imports, like
 * ./umami.ts.
 */

import { SIGNED_IN_PREFIXES } from "../app-routes";
import {
  BEFORE_SEND_GLOBAL,
  createAnalyticsGuard,
  trackerScript,
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

/** window.localStorage, or null where reading it throws. */
function storageOf(win: AnalyticsWindow): MarkerStorage | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

/** The guard for `win`'s browser, reading the time from `now`. */
function guardFor(win: AnalyticsWindow, now: () => number): AnalyticsGuard {
  return createAnalyticsGuard({
    signedInPrefixes: SIGNED_IN_PREFIXES,
    storage: storageOf(win),
    now,
    doNotTrack: win.navigator.doNotTrack,
    globalPrivacyControl: win.navigator.globalPrivacyControl,
  });
}

/**
 * Runs the page checks for the page `win` shows now, at time `now` (ms).
 * A signed-in page marks the browser, whether or not the tracker is
 * loaded. Returns the tracker tag to inject the first time a page may load
 * it, with the send guard installed, else null. Uses localStorage only,
 * never cookies.
 */
export function startAnalytics(
  win: AnalyticsWindow,
  config: UmamiConfig,
  now: number
): TrackerTag | null {
  if (!guardFor(win, () => now).shouldLoad(win.location.pathname)) return null;
  // Loaded already: the tracker follows client navigation by itself.
  if (win[BEFORE_SEND_GLOBAL] !== undefined) return null;
  // The guard checks each send when it happens, so it reads the clock then.
  win[BEFORE_SEND_GLOBAL] = guardFor(win, Date.now).beforeSend;
  return trackerScript(config);
}
