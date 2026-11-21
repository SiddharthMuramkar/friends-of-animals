// A campaign's life: drafted, sent once, then finished. Staff edit and send
// a draft and may cancel it while it is still a draft or sending. The worker
// marks it sent once no message is waiting. The schema builds its enums from
// the lists below, all declared now, because adding an enum value later and
// using it in the same migration run fails.
//
// Pure: loads under plain Node (schema, seed), relative imports only.

export const CAMPAIGN_STATUSES = [
  "draft",
  "sending",
  "sent",
  "cancelled",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** SMS is not offered: campaign SMS needs a promotional DLT template. */
export const CAMPAIGN_CHANNELS = ["email", "in_app"] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const CAMPAIGN_DELIVERY_STATUSES = [
  "queued",
  "sent",
  "skipped",
  "failed",
] as const;
export type CampaignDeliveryStatus =
  (typeof CAMPAIGN_DELIVERY_STATUSES)[number];

export const DELIVERY_SKIP_REASONS = [
  "consent_withdrawn",
  "cancelled",
] as const;
export type DeliverySkipReasonCode = (typeof DELIVERY_SKIP_REASONS)[number];

/**
 * What can happen to a campaign. `complete` is the worker's, once every
 * message is settled; the rest are staff actions.
 */
export type CampaignAction = "edit" | "send" | "cancel" | "complete";

export type CampaignRefusal =
  /** Only a draft can be edited or sent. */
  | "not_draft"
  /** Sent and cancelled campaigns are final. */
  | "campaign_finished"
  /** Only a campaign being sent can be completed. */
  | "not_sending";

export type CampaignDecision =
  | { ok: true; next: CampaignStatus }
  | { ok: false; reason: CampaignRefusal };

const FINISHED: ReadonlySet<CampaignStatus> = new Set<CampaignStatus>([
  "sent",
  "cancelled",
]);

/** Whether `action` is allowed on a campaign in `status`, and what follows. */
export function decideCampaign(
  status: CampaignStatus,
  action: CampaignAction
): CampaignDecision {
  switch (action) {
    case "edit":
      return status === "draft"
        ? { ok: true, next: "draft" }
        : { ok: false, reason: "not_draft" };
    case "send":
      if (status === "draft") return { ok: true, next: "sending" };
      return {
        ok: false,
        reason: FINISHED.has(status) ? "campaign_finished" : "not_draft",
      };
    case "cancel":
      return FINISHED.has(status)
        ? { ok: false, reason: "campaign_finished" }
        : { ok: true, next: "cancelled" };
    case "complete":
      return status === "sending"
        ? { ok: true, next: "sent" }
        : { ok: false, reason: "not_sending" };
  }
}

/** One delivery row, as the summary needs it. */
export type DeliveryOutcome =
  | { status: "queued" | "sent" | "failed" }
  | { status: "skipped"; reason: DeliverySkipReasonCode };

export type DeliverySummary = {
  queued: number;
  sent: number;
  failed: number;
  skipped: { consentWithdrawn: number; cancelled: number };
  /** No message is waiting, so a sending campaign can be marked sent. */
  settled: boolean;
};

/**
 * The counts a campaign shows and audits once sent: numbers only, never
 * who. `settled` says whether the worker may complete it.
 */
export function summariseDeliveries(
  outcomes: readonly DeliveryOutcome[]
): DeliverySummary {
  const summary: DeliverySummary = {
    queued: 0,
    sent: 0,
    failed: 0,
    skipped: { consentWithdrawn: 0, cancelled: 0 },
    settled: true,
  };
  for (const outcome of outcomes) {
    if (outcome.status === "skipped") {
      if (outcome.reason === "consent_withdrawn") {
        summary.skipped.consentWithdrawn += 1;
      } else {
        summary.skipped.cancelled += 1;
      }
    } else {
      summary[outcome.status] += 1;
    }
  }
  summary.settled = summary.queued === 0;
  return summary;
}
