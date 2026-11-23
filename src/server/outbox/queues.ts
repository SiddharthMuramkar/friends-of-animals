// Which relay runs which handlers. Every handler runs in the default queue
// (the VPS worker, the preview drain route) unless it is listed under a
// dedicated queue here; then only that queue's own process claims its
// deliveries, so heavy work never runs on Vercel or holds up the default
// worker. The Seam 1 harness drains every queue.
//
//   media  worker-media (#85): image derivatives. Video transcodes (#86),
//          stamping (#102) and the gallery's copies (#103) append here.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import type { HandlerName } from "./events";

export const DEDICATED_QUEUES = {
  media: ["files.process_image"],
} as const satisfies Record<string, readonly HandlerName[]>;

export type DedicatedQueue = keyof typeof DEDICATED_QUEUES;

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
