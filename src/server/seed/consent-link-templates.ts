// HR-33 draft wording, available only in the local and preview seed.
import { createTranslator } from "next-intl";

import deliveryWords from "../../../messages/en-IN/guardianConsentDelivery.json";
import { LOCALE } from "../../i18n/formats";

import { messageTemplate } from "../db/schema";
import {
  CONSENT_LINK_VARIABLES,
  GUARDIAN_CONSENT_LINK_TEMPLATE,
} from "../modules/consent-links/delivery";
import type { SeedDeps } from "./types";

export async function seedConsentLinkTemplates({ db, clock }: SeedDeps) {
  const t = createTranslator({
    locale: LOCALE,
    messages: deliveryWords,
    namespace: "guardianConsentDelivery.link",
  });
  // Insert the delivery placeholder for the outbox handler to fill later.
  const vars = { link: "{{link}}" };
  await db
    .insert(messageTemplate)
    .values([
      {
        key: GUARDIAN_CONSENT_LINK_TEMPLATE,
        channel: "email",
        subject: t("email.subject"),
        body: t("email.text", vars),
        variables: [...CONSENT_LINK_VARIABLES],
        updatedAt: clock.now(),
      },
      {
        key: GUARDIAN_CONSENT_LINK_TEMPLATE,
        channel: "sms",
        body: t("sms.text", vars),
        variables: [...CONSENT_LINK_VARIABLES],
        updatedAt: clock.now(),
      },
    ])
    .onConflictDoNothing();
}
