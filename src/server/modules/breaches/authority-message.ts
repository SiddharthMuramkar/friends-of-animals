// The outbox handler breaches.send_authority_notice: emails the authority
// about a breach (#116). The authority is an address, not a user, so the
// dispatcher, which sends to users, can't reach it: its route row (audience
// `breach_authority`) resolves to nobody. This handler reads that row
// instead. While it is enabled with email, it renders the row's template
// (staff edit its wording; counsel approves it, HR-49) with the breach's
// facts (./notice-message.ts) and sends it to the address in the setting
// `breach.authorityEmail`, read when it sends.
//
// At least once, but one email per breach: authority_email_sent_at is set
// after the send, and a breach already sent for is skipped. A worker that
// dies between the two sends it again on the retry. With the setting
// emptied since the request, it fails (naming the breach by id) and the
// outbox retries it, so staff see it among failed deliveries.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq } from "drizzle-orm";

import { breachRecord, messageRoute, messageTemplate } from "../../db/schema";
import { oneLineSubject } from "../../ports/email";
import type { OutboxDeps } from "../../outbox/handlers";
import {
  renderEmailHtml,
  renderTemplate,
} from "../notifications/domain/template";
import { DEFAULT_LOCALE } from "../notifications/locale";
import { authorityNoticeValues } from "./notice-message";

/** The audience of the route row that tells the authority. */
export const AUTHORITY_AUDIENCE = "breach_authority";

export async function sendAuthorityNotice(
  deps: Pick<OutboxDeps, "db" | "clock" | "email" | "settings">,
  notice: { breachId: string }
): Promise<void> {
  const { breachId } = notice;
  const [breach] = await deps.db
    .select({ sentAt: breachRecord.authorityEmailSentAt })
    .from(breachRecord)
    .where(eq(breachRecord.id, breachId));
  // Gone (retention) or already emailed: nothing to send.
  if (!breach || breach.sentAt) return;

  // Switched off, or not by email: the authority isn't emailed.
  const [route] = await deps.db
    .select({
      templateKey: messageRoute.templateKey,
      channels: messageRoute.channels,
    })
    .from(messageRoute)
    .where(
      and(
        eq(messageRoute.eventType, "breach.authority_notice"),
        eq(messageRoute.audience, AUTHORITY_AUDIENCE),
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
  if (!template) throw new Error(`Template ${route.templateKey} has no email`);

  const to = (await deps.settings.get("breach.authorityEmail")).trim();
  if (!to) {
    throw new Error(
      `breach.authorityEmail is unset: breach ${breachId}'s notice waits`
    );
  }
  const values = await authorityNoticeValues(deps.db, breachId);
  if (!values) return;

  const text = renderTemplate(template.body, values);
  await deps.email.send({
    to,
    subject: oneLineSubject(renderTemplate(template.subject ?? "", values)),
    text,
    html: renderEmailHtml(text),
  });
  await deps.db
    .update(breachRecord)
    .set({ authorityEmailSentAt: deps.clock.now() })
    .where(eq(breachRecord.id, breachId));
}
