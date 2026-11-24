// Every campaign message carries a withdrawal link (#126): one per
// recipient row, at /withdraw/<token>. The token is a keyed hash of the
// row's id under FIELD_HMAC_KEY (the blind index), so the send stores only
// its SHA-256 and the worker can build the same link again on any retry
// without keeping the token anywhere. Without the key nobody can make a
// valid token, and the token says nothing about the person.
//
// Opening the link changes nothing (mail scanners open links); the page
// asks before it withdraws.
//
// Loads under plain Node (the worker): relative imports only.

import type { BlindIndex } from "../../crypto/blind-index";
import { hashLinkToken } from "../../crypto/link-token";
import { withdrawalPath } from "../../../lib/app-routes";

const PURPOSE = "campaign_recipient.withdrawal_link";

/** 64 lower-case hex characters: an HMAC-SHA-256. */
const WELL_FORMED = /^[0-9a-f]{64}$/;

export function withdrawalToken(blindIndex: BlindIndex, recipientId: string) {
  const token = blindIndex.of(PURPOSE, recipientId);
  return { token, tokenHash: hashLinkToken(token) };
}

/** Whether `value` could be a withdrawal token, before any lookup. */
export function isWellFormedWithdrawalToken(value: unknown): value is string {
  return typeof value === "string" && WELL_FORMED.test(value);
}

/** The absolute link for one recipient, on the site's base URL. */
export function withdrawalUrl(
  baseUrl: string,
  blindIndex: BlindIndex,
  recipientId: string
): string {
  const { token } = withdrawalToken(blindIndex, recipientId);
  return new URL(withdrawalPath(token), baseUrl).href;
}
