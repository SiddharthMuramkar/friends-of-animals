// HR-33 draft wording, available only in the local and preview seed.
import { messageTemplate } from "../db/schema";
import {
  CONSENT_LINK_VARIABLES,
  GUARDIAN_CONSENT_LINK_TEMPLATE,
} from "../modules/consent-links/delivery";
import type { SeedDeps } from "./types";

export async function seedConsentLinkTemplates({ db, clock }: SeedDeps) {
  await db
    .insert(messageTemplate)
    .values([
      {
        key: GUARDIAN_CONSENT_LINK_TEMPLATE,
        channel: "email",
        subject: "Review a guardian consent request",
        body: "Your school has asked you to review consent choices for a competition. To view the request and verify with a one-time code, open {{link}}. The link expires in seven days.\n\nFriends of Animals",
        variables: [...CONSENT_LINK_VARIABLES],
        updatedAt: clock.now(),
      },
      {
        key: GUARDIAN_CONSENT_LINK_TEMPLATE,
        channel: "sms",
        body: "Friends of Animals: Review a guardian consent request at {{link}}. This link expires in seven days.",
        variables: [...CONSENT_LINK_VARIABLES],
        updatedAt: clock.now(),
      },
    ])
    .onConflictDoNothing();
}
