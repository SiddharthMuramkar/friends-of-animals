// What the consent page says after a change, from the action's redirect.
// Pure, so the mapping is tested without a page.

import type { GiveConsentResult } from "@/server/modules/consent";

export const CONSENT_NOTICES = [
  "given",
  "withdrawn",
  "publicationWithdrawn",
  "auctionGiven",
  "auctionWithdrawn",
  "outdated",
  "failed",
] as const;

export type ConsentNotice = (typeof CONSENT_NOTICES)[number];

/**
 * What giving consent did. Only a newer version published meanwhile
 * means the text changed; any other refusal saved nothing.
 */
export function noticeAfterGive(result: GiveConsentResult): ConsentNotice {
  if (result.ok) return "given";
  return result.error === "document_outdated" ? "outdated" : "failed";
}
