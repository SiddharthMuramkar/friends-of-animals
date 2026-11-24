// One outbox handler reaches accounts and contact details from the same
// roster. A retry rechecks eligibility at the announcement's send date.

import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { sendToContact } from "../notifications/contact-delivery";
import { deliverInApp } from "../notifications/dispatch";
import { loadAnnouncementDeliveryPlan } from "./delivery-plan";
import { announcementMessageFor } from "./render";

export async function fanOutAnnouncement(
  deps: OutboxDeps,
  delivery: Delivery<"competition.announcement_sent">
): Promise<void> {
  const message = await announcementMessageFor(deps, delivery.payload);
  if (!message) return;
  const smsEnabled = await deps.settings.get("sms.enabled");
  const { deliveries } = await loadAnnouncementDeliveryPlan(
    deps,
    delivery.payload.competitionId,
    message.sentAt ?? delivery.occurredAt,
    smsEnabled
  );

  let failure: unknown = null;
  for (const {
    recipient,
    route,
    templates,
    email,
    phone,
    plan,
  } of deliveries) {
    const { contact } = recipient;
    const values = { ...message.values, "recipient.name": contact.name ?? "" };
    const error = await sendToContact(
      deps,
      {
        delivery,
        route,
        templates,
        contactKey: recipient.key,
        contactAliases: recipient.aliases,
        email,
        phone,
        values,
      },
      smsEnabled,
      plan
    );
    failure ??= error;
    if (contact.kind === "account" && plan.deliver.includes("in_app")) {
      await deliverInApp(deps, {
        delivery,
        route,
        templates,
        recipient: { id: contact.userId },
        values,
      });
    }
  }
  // The relay retries the event. A successful delivery retains its claim.
  if (failure !== null) throw failure;
}
