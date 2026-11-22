// The chip tone of each refund status (#80): meaning by words first,
// colour only as a second cue.

import type { RefundStatus } from "@/server/modules/payments/domain/refund-status";

const TONES = {
  requested: "marigold",
  approved: "blue",
  processing: "blue",
  refunded: "green",
  rejected: "neutral",
  failed: "pink",
} as const satisfies Record<RefundStatus, string>;

export function statusTone(status: RefundStatus): (typeof TONES)[RefundStatus] {
  return TONES[status];
}
