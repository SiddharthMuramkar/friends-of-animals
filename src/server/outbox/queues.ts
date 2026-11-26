// Which relay runs which handlers. Every handler runs in the default queue
// (the VPS worker, the preview drain route) unless it is listed under a
// dedicated queue here; then only that queue's own process claims its
// deliveries, so heavy work never runs on Vercel or holds up the default
// worker. The Seam 1 harness drains every queue.
//
//   media  worker-media (#85): image derivatives, video transcodes (#86)
//          and raster-only essay PDF copies (#96). Stamping (#102) and the gallery's copies (#103) append
//          here.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import type { HandlerName } from "./events";

export const DEDICATED_QUEUES = {
  media: [
    "files.process_image",
    "files.process_video",
    "files.process_pdf",
    "certificate.render",
    "certificates.build_archive",
    "stamping.render",
  ],
} as const satisfies Record<string, readonly HandlerName[]>;

export type DedicatedQueue = keyof typeof DEDICATED_QUEUES;

const MINUTE = 60 * 1000;

/**
 * Handlers one run of which can outlast the default lease (5 minutes,
 * ./retry-policy.ts), and the lease a claim of theirs gets instead, so no
 * relay takes a delivery over while it is still running.
 */
export const HANDLER_LEASE_MS: Readonly<Partial<Record<HandlerName, number>>> =
  {
    // ffmpeg's deadline for a 3-minute clip is 13 minutes
    // (planVideoTranscode), plus a minute each for the probe and poster.
    "files.process_video": 20 * MINUTE,
  };

/** A queue a relay drains; "all" is every handler (the Seam 1 harness). */
export type QueueName = "default" | DedicatedQueue | "all";

const DEDICATED: ReadonlySet<string> = new Set(
  Object.values(DEDICATED_QUEUES).flat()
);

/** The handlers among `known` that a relay draining `queue` claims. */
export function handlersInQueue(
  queue: QueueName,
  known: readonly string[]
): string[] {
  if (queue === "all") return [...known];
  if (queue === "default") return known.filter((name) => !DEDICATED.has(name));
  const listed: readonly string[] = DEDICATED_QUEUES[queue];
  return known.filter((name) => listed.includes(name));
}
