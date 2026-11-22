// The outbox handler contact.send_acknowledgement: emails the sender of a
// contact message their reference (#113). The sender has no account, so the
// dispatcher, which sends to users, can't reach them: their route row
// (audience `contact_sender`) resolves to nobody. This handler reads that
// row instead. While it is enabled with email, it renders the row's
// template (staff edit its wording, HR-50) and sends it to the sender's
// address through the email port.
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

import { and, asc, eq } from "drizzle-orm";

import { contactMessage, messageRoute, messageTemplate } from "../../db/schema";
import {
  renderEmailHtml,
  renderTemplate,
} from "../notifications/domain/template";
import { DEFAULT_LOCALE } from "../notifications/locale";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { contactMessageValues } from "./notify";

/** The audience of the route row that tells the sender. */
export const SENDER_AUDIENCE = "contact_sender";

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

  // Switched off, or not by email: the sender isn't told.
  const [route] = await deps.db
    .select({
      templateKey: messageRoute.templateKey,
      channels: messageRoute.channels,
    })
    .from(messageRoute)
    .where(
      and(
        eq(messageRoute.eventType, delivery.eventType),
        eq(messageRoute.audience, SENDER_AUDIENCE),
        eq(messageRoute.enabled, true)
      )
    )
    .orderBy(asc(messageRoute.createdAt))
    .limit(1);
  if (!route?.channels.includes("email")) return;

  const [template] = await deps.db
    .select({ subject: messageTemplate.subject, body: messageTemplate.body })
    .from(messageTemplate)
    .where(
      and(
        eq(messageTemplate.key, route.templateKey),
        eq(messageTemplate.channel, "email"),
        eq(messageTemplate.locale, DEFAULT_LOCALE)
      )
    );
  if (!template) {
    throw new Error(`Template ${route.templateKey} has no email`);
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
