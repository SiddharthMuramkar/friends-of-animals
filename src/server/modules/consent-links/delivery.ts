import { and, eq } from "drizzle-orm";

import { consentLinkPath } from "../../../lib/app-routes";
import { parsePhoneNumber } from "../../../lib/phone";
import {
  consentLink,
  messageTemplate,
  type ConsentLink,
} from "../../db/schema";
import type { OutboxDeps } from "../../outbox";
import { oneLineSubject } from "../../ports/email";
import { renderTemplate } from "../notifications/domain/template";
import { DEFAULT_LOCALE } from "../notifications/locale";
import { closedReason } from "./domain/link";
import {
  activeLinkTarget,
  consentLinksActive,
  LINK_CONTACT,
  LINK_TOKEN,
} from "./repository";

export const GUARDIAN_CONSENT_LINK_TEMPLATE = "guardian_consent_link";
export const CONSENT_LINK_VARIABLES = ["link"] as const;

type ContactDelivery = Pick<OutboxDeps, "cipher" | "email" | "sms">;

/** The link and its verification code both go only to the snapshotted contact. */
export async function sendToLinkContact(
  deps: ContactDelivery,
  link: Pick<ConsentLink, "channel" | "contactCiphertext">,
  message: {
    subject: string;
    text: string;
    vars: Record<string, string>;
    dltTemplateId?: string;
  }
) {
  const address = deps.cipher.decrypt(LINK_CONTACT, link.contactCiphertext);
  try {
    if (link.channel === "email") {
      await deps.email.send({
        to: address,
        subject: oneLineSubject(message.subject),
        text: message.text,
      });
    } else {
      const phone = parsePhoneNumber(address);
      if (!phone.ok) throw new Error("Invalid stored guardian phone");
      await deps.sms.send({
        to: phone.e164,
        template: "message",
        vars: message.vars,
        text: message.text,
        dltTemplateId: message.dltTemplateId,
      });
    }
  } catch {
    // Providers can include the recipient or the message in their error.
    throw new Error("Guardian consent message could not be delivered");
  }
}

/** Outbox deliveries contain only the id. Read the secrets at send time. */
export async function deliverConsentLink(
  deps: OutboxDeps,
  { linkId }: { linkId: string }
) {
  if (!consentLinksActive(deps.appEnv)) return;
  const [link] = await deps.db
    .select()
    .from(consentLink)
    .where(eq(consentLink.id, linkId));
  if (!link?.tokenCiphertext || closedReason(link, deps.clock.now())) return;
  if (!(await activeLinkTarget(deps.db, link))) return;
  if (link.channel === "sms" && !(await deps.settings.get("sms.enabled")))
    return;

  const [template] = await deps.db
    .select()
    .from(messageTemplate)
    .where(
      and(
        eq(messageTemplate.key, GUARDIAN_CONSENT_LINK_TEMPLATE),
        eq(messageTemplate.locale, DEFAULT_LOCALE),
        eq(messageTemplate.channel, link.channel)
      )
    );
  if (!template || !deps.auth.baseUrl) {
    throw new Error(
      "Guardian consent delivery needs its template and site URL"
    );
  }

  const token = deps.cipher.decrypt(LINK_TOKEN, link.tokenCiphertext);
  const vars = {
    link: new URL(consentLinkPath(token), deps.auth.baseUrl).href,
  };
  await sendToLinkContact(deps, link, {
    subject: renderTemplate(template.subject ?? "", vars),
    text: renderTemplate(template.body, vars),
    vars,
    ...(template.dltTemplateId
      ? { dltTemplateId: template.dltTemplateId }
      : {}),
  });
}
