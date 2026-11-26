import { z } from "zod";
import { isFallbackGateway } from "../../../ports/payment-gateway-fallback";
import type { UseCaseContext } from "../../../use-cases";
import { getMyRecurringDonation } from "./list";
import { syncRecurringDonation } from "./sync";

export async function confirmRecurringCheckout(
  ctx: UseCaseContext,
  input: { id: string; paymentId: string; signature: string }
) {
  const parsed = z
    .object({
      id: z.uuid(),
      paymentId: z.string().min(1).max(100),
      signature: z.string().max(256),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" } as const;
  const found = await getMyRecurringDonation(ctx, input);
  if (!found.ok || !found.checkout)
    return { ok: false, error: "not_found" } as const;
  const subscriptionId = found.recurring.gatewaySubscriptionId;
  if (
    !ctx.payments.verifySubscriptionCheckout({
      subscriptionId,
      paymentId: input.paymentId,
      signature: input.signature,
    })
  )
    return { ok: false, error: "invalid_signature" } as const;
  const status = await syncRecurringDonation(ctx, subscriptionId);
  return { ok: true, status } as const;
}

export async function payRecurringTestCheckout(
  ctx: UseCaseContext,
  input: { id: string }
) {
  const found = await getMyRecurringDonation(ctx, input);
  if (!found.ok || !found.checkout)
    return { ok: false, error: "not_found" } as const;
  if (ctx.appEnv === "production" || !isFallbackGateway(ctx.payments))
    return { ok: false, error: "forbidden" } as const;
  if (
    found.recurring.status !== "pending_authorisation" ||
    found.recurring.cancelRequestedAt
  )
    return { ok: false, error: "not_pending" } as const;
  const result = await ctx.payments.authoriseSubscription(
    found.recurring.gatewaySubscriptionId
  );
  if (!result) return { ok: false, error: "not_pending" } as const;
  return confirmRecurringCheckout(ctx, { id: input.id, ...result });
}
