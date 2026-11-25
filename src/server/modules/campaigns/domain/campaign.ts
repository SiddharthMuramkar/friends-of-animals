// A campaign's life and wording (#126). A community manager writes a draft
// and sends it once: sending queues one message per recipient and the
// campaign is `sending` until the worker has settled every one, then
// `sent`. A sent campaign is never edited or sent again; a correction is a
// new campaign. Each recipient's message is `queued`, then `sent`, or
// `skipped` when the consent it rested on no longer held at send time.
//
// The schema builds its enums from these lists, all declared now (rule F2).
//
// Pure: loads under plain Node (schema, seed), relative imports only.

import { z } from "zod";

import { subjectHasBreak } from "../../../ports/email";

export const CAMPAIGN_STATUSES = ["draft", "sending", "sent"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_RECIPIENT_STATUSES = [
  "queued",
  "sent",
  "skipped",
] as const;
export type CampaignRecipientStatus =
  (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

const MOVES: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  draft: ["sending"],
  sending: ["sent"],
  sent: [],
};

/** Whether a campaign in `from` may move to `to`. */
export function canMoveCampaign(
  from: CampaignStatus,
  to: CampaignStatus
): boolean {
  return MOVES[from].includes(to);
}

export const CAMPAIGN_LIMITS = { subject: 150, body: 5_000 } as const;

/**
 * What a campaign says: plain text, never HTML. The message template wraps
 * it (`campaigns.message`), and the renderer escapes it for email.
 */
export const campaignContentSchema = z.strictObject({
  subject: z
    .string()
    .trim()
    .min(1)
    .max(CAMPAIGN_LIMITS.subject)
    .refine((subject) => !subjectHasBreak(subject)),
  body: z
    .string()
    .transform((body) => body.replace(/\r\n?/gu, "\n"))
    .pipe(z.string().trim().min(1).max(CAMPAIGN_LIMITS.body)),
});

export type CampaignContent = z.output<typeof campaignContentSchema>;
export type CampaignContentInput = z.input<typeof campaignContentSchema>;
