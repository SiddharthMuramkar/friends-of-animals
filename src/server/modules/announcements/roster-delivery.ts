// Sends one message to everyone a roster delivery plan names
// (./delivery-plan.ts): email and SMS through the contact path, and an
// inbox item for each account the plan gives one. Shared by the
// announcement fan-out and the reminders (84b). Each send claims its
// delivery row under `delivery.eventId`, so running this again sends
// nobody a second copy.
//
// Loads under plain Node (the worker): relative imports only.

import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { sendToContact } from "../notifications/contact-delivery";
import { deliverInApp } from "../notifications/dispatch";
import type { loadRosterDeliveryPlan } from "./delivery-plan";

export type RosterDelivery = Awaited<
  ReturnType<typeof loadRosterDeliveryPlan>
>["deliveries"][number];

/**
 * Delivers to each planned recipient with `values` and their own name.
 * Returns the first failure (the others still went), or null.
 */
export async function deliverToRoster(
  deps: OutboxDeps,
  delivery: Delivery,
  deliveries: readonly RosterDelivery[],
  values: Record<string, string>,
  smsEnabled: boolean
): Promise<unknown> {
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
    const personal = { ...values, "recipient.name": contact.name ?? "" };
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
        values: personal,
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
        values: personal,
      });
    }
  }
  return failure;
}
