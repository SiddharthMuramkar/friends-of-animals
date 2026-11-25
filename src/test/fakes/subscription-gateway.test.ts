import { subscriptionGatewayContract } from "@/server/ports/subscription-gateway.contract";
import { FakePaymentGateway } from "./payment-gateway";
import { FakeClock } from "./clock";
subscriptionGatewayContract("FakePaymentGateway", async () => {
  const clock = new FakeClock();
  const gateway = new FakePaymentGateway("", clock);
  return {
    gateway,
    clock,
    authorise: async (id) => gateway.authoriseSubscription(id),
    charge: async (id, options) => gateway.chargeSubscription(id, options),
  };
});
