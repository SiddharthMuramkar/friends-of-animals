import { as } from "@/server/app";
import { productionDeps } from "@/server/deps";

import { receiveWebhookRequest, webhookActor } from "./_lib/gateway-webhook";

// Razorpay's webhook (#77): rules in ./_lib/gateway-webhook.ts. No session
// and no proxy: src/proxy.ts doesn't match /api, so nothing redirects it.
// A POST handler is never prerendered.

export async function POST(request: Request): Promise<Response> {
  return receiveWebhookRequest(
    as(webhookActor(request.headers)),
    request,
    productionDeps().errors
  );
}
