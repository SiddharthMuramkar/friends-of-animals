import type { ContactMessageStatus } from "@/server/modules/contact/domain/status";

/** Each status's chip colour, always beside its word. */
export const STATUS_TONE = {
  new: "blue",
  in_progress: "marigold",
  closed: "neutral",
} as const satisfies Record<ContactMessageStatus, string>;
