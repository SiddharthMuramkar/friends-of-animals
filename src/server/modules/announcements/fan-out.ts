// One outbox handler reaches accounts and contact details from the same
// roster. A retry rechecks eligibility at the announcement's send date.

import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { loadAnnouncementDeliveryPlan } from "./delivery-plan";
import { announcementMessageFor } from "./render";
import { deliverToRoster } from "./roster-delivery";

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
  const failure = await deliverToRoster(
    deps,
    delivery,
    deliveries,
    message.values,
    smsEnabled
  );
  // The relay retries the event. A successful delivery retains its claim.
  if (failure !== null) throw failure;
}
