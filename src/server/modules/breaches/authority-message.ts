// The outbox handler breaches.send_authority_notice: emails the authority
// about a breach (#116). The authority is an address, not a user, so the
// dispatcher, which sends to users, can't reach it: its route row (audience
// `breach_authority`) resolves to nobody. This handler reads that row
// instead. While it is enabled with email, it renders the row's template
// (staff edit its wording; counsel approves it, HR-49) with the breach's
// facts (./notice-message.ts) and sends it to the address in the setting
// `breach.authorityEmail`, read when it sends.
//
// The breach lock serializes email delivery with manual filing. An email
// waits for a usable address and an enabled route, and a completed notice
// retires the pending work. Delivery remains at least once if the worker
// dies between the provider accepting the email and the transaction committing.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq } from "drizzle-orm";

import { recordAudit } from "../../audit/record";
import { messageRoute, messageTemplate } from "../../db/schema";
import { oneLineSubject } from "../../ports/email";
import type { OutboxDeps } from "../../outbox/handlers";
import {
  renderEmailHtml,
  renderTemplate,
} from "../notifications/domain/template";
import { DEFAULT_LOCALE } from "../notifications/locale";
import { readSetting } from "../settings/read";
import { completeAuthorityNotice } from "./authority";
import { breachAuditSnapshot } from "./domain/audit";
import { configuredAuthorityEmail } from "./domain/authority-notice";
import { authorityNoticeValues } from "./notice-message";
import { lockBreach } from "./record";

/** The audience of the route row that tells the authority. */
export const AUTHORITY_AUDIENCE = "breach_authority";

export async function sendAuthorityNotice(
  deps: Pick<OutboxDeps, "db" | "clock" | "cipher" | "email">,
  { breachId }: { breachId: string }
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const breach = await lockBreach(tx, breachId);
    if (!breach?.authorityEmailQueuedAt || breach.authorityNotifiedAt) return;

    const to = configuredAuthorityEmail(
      await readSetting(tx, "breach.authorityEmail")
    );
    if (!to) {
      throw new Error(
        `breach.authorityEmail is unusable: breach ${breachId}'s notice waits`
      );
    }

    const [route] = await tx
      .select({
        templateKey: messageRoute.templateKey,
        channels: messageRoute.channels,
      })
      .from(messageRoute)
      .where(
        and(
          eq(messageRoute.eventType, "breach.authority_notice"),
          eq(messageRoute.audience, AUTHORITY_AUDIENCE),
          eq(messageRoute.templateKey, "breach.authority_notice"),
          eq(messageRoute.requiredByLaw, true),
          eq(messageRoute.enabled, true)
        )
      )
      .for("share");
    if (!route?.channels.includes("email")) {
      throw new Error("No enabled authority email route");
    }

    const [template] = await tx
      .select({ subject: messageTemplate.subject, body: messageTemplate.body })
      .from(messageTemplate)
      .where(
        and(
          eq(messageTemplate.key, route.templateKey),
          eq(messageTemplate.channel, "email"),
          eq(messageTemplate.locale, DEFAULT_LOCALE)
        )
      );
    if (!template)
      throw new Error(`Template ${route.templateKey} has no email`);

    const values = authorityNoticeValues(deps.cipher, breach);
    const text = renderTemplate(template.body, values);
    await deps.email.send({
      to,
      subject: oneLineSubject(renderTemplate(template.subject ?? "", values)),
      text,
      html: renderEmailHtml(text),
    });
    const updated = await completeAuthorityNotice(
      tx,
      breach,
      deps.clock.now(),
      {
        channel: "email",
      }
    );
    await recordAudit(
      tx,
      { clock: deps.clock, actor: { kind: "system", process: "worker" } },
      {
        action: "breach.authority_notified",
        entity: { type: "breach", id: breachId },
        actorRole: null,
        before: breachAuditSnapshot(breach),
        after: breachAuditSnapshot(updated),
      }
    );
  });
}
