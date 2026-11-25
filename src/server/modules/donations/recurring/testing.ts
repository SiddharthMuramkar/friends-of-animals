import { createHarness } from "@/test/harness";
import { openDonations } from "../testing";
export async function setup() {
  const h = await createHarness({ now: "2026-11-25T05:00:00.000Z" });
  await openDonations(h);
  await h.settings.set("donations.recurringEnabled", true);
  const actor = await h.signIn(await h.seed.member());
  const start = await h.as(actor).startRecurringDonation({
    amountMinor: 100_000n,
    showOnWall: false,
    declaredAdult: true,
    declaredIndianSource: true,
  });
  if (!start.ok) throw new Error("Could not start recurring donation");
  const id = start.id;
  const subscriptionId = start.checkout.subscriptionId;
  const signal = (type: string) =>
    h.gateway.webhook({ type, orderId: null, subscriptionId });
  const send = (type: string) =>
    h.as(h.visitor()).receiveGatewayWebhook(signal(type));
  return { h, actor, id, subscriptionId, signal, send };
}
