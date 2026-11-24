// Who may do what with campaigns (#126): community managers write, preview
// and send them. Anyone holding a message's withdrawal link may open it and
// withdraw the consent it was sent on: the link is the bearer credential,
// signed in or not.
//
// Loads under plain Node: relative imports only.

import {
  anyOf,
  role,
  signedIn,
  signedOut,
  type Policy,
} from "../../access/domain/policy";

export const CAMPAIGNS_POLICY = {
  /** Create, edit, read, list, preview and send. */
  "campaign.manage": role("community_manager"),
  /** Open a withdrawal link and withdraw by it. */
  "campaign.withdrawal_link": anyOf(signedOut, signedIn),
} satisfies Policy<string>;

export type CampaignsAction = keyof typeof CAMPAIGNS_POLICY;
