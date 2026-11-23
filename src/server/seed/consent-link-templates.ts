// HR-33 draft wording, available only in the local and preview seed.
import deliveryWords from "../../../messages/en-IN/guardianConsentDelivery.json";

import { messageTemplate } from "../db/schema";
import {
  CONSENT_LINK_VARIABLES,
  GUARDIAN_CONSENT_LINK_TEMPLATE,
} from "../modules/consent-links/delivery";
import type { SeedDeps } from "./types";

export async function seedConsentLinkTemplates({ db, clock }: SeedDeps) {
  const { email, sms } = deliveryWords.guardianConsentDelivery.link;
  await db
    .insert(messageTemplate)
    .values([
      {
        key: GUARDIAN_CONSENT_LINK_TEMPLATE,
        channel: "email",
        subject: email.subject,
        body: email.text,
        variables: [...CONSENT_LINK_VARIABLES],
        updatedAt: clock.now(),
      },
      {
        key: GUARDIAN_CONSENT_LINK_TEMPLATE,
        channel: "sms",
        body: sms.text,
        variables: [...CONSENT_LINK_VARIABLES],
        updatedAt: clock.now(),
      },
    ])
    .onConflictDoNothing();
}
