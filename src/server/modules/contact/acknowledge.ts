// The outbox handler contact.send_acknowledgement: emails the sender of a
// contact message their reference (#113). The sender has no account, so
// notifications' route rows, which address users, can't reach them; this
// handler renders notifications' `contact.acknowledgement` email template
// (staff edit its wording, HR-50) and sends it through the email port.
//
// Anti-relay: the email says only the reference and the topic, never the
// name, subject or message the sender typed. Otherwise the form would mail
// anyone's words to any address, from FOA.
//
// At least once, but one email per message: acknowledged_at is set after
// the send, and a message already acknowledged is skipped. A worker that
// dies between the two sends it again on the retry.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq } from "drizzle-orm";

import { contactMessage, messageTemplate } from "../../db/schema";
import {
  renderEmailHtml,
  renderTemplate,
} from "../../notifications/domain/template";
import { DEFAULT_LOCALE } from "../../notifications/locale";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { contactMessageValues } from "./notify";

export const ACKNOWLEDGEMENT_TEMPLATE = "contact.acknowledgement";

export async function sendContactAcknowledgement(
  deps: OutboxDeps,
  delivery: Delivery<"contact_message.received">
): Promise<void> {
  const { messageId } = delivery.payload;
  const [message] = await deps.db
    .select({
      email: contactMessage.email,
      acknowledgedAt: contactMessage.acknowledgedAt,
    })
    .from(contactMessage)
    .where(eq(contactMessage.id, messageId));
  // Gone (erased) or already acknowledged: nothing to send.
  if (!message || message.acknowledgedAt) return;

  const [template] = await deps.db
    .select({ subject: messageTemplate.subject, body: messageTemplate.body })
    .from(messageTemplate)
    .where(
      and(
        eq(messageTemplate.key, ACKNOWLEDGEMENT_TEMPLATE),
        eq(messageTemplate.channel, "email"),
        eq(messageTemplate.locale, DEFAULT_LOCALE)
      )
    );
  if (!template) {
    throw new Error(`Template ${ACKNOWLEDGEMENT_TEMPLATE} has no email`);
  }
  const values = await contactMessageValues(deps.db, messageId);
  if (!values) return;

  const text = renderTemplate(template.body, values);
  await deps.email.send({
    to: message.email,
    subject: renderTemplate(template.subject ?? "", values),
    text,
    html: renderEmailHtml(text),
  });
  await deps.db
    .update(contactMessage)
    .set({ acknowledgedAt: deps.clock.now() })
    .where(eq(contactMessage.id, messageId));
}
