// POST /api/webhooks/razorpay (#77), as a plain function over the use
// cases so it is tested at Seam 1; the route handler only wires it up.
//
// The gateway posts with no session: the signature over the raw body is
// what authorises it, so the use case runs as a visitor built from the
// request (receiveGatewayWebhook accepts anyone, and refuses the system
// actor). The body is read as text, at most WEBHOOK_MAX_BYTES, and handed
// over byte for byte: parsing it first would break the signature.
//
//   genuine (applied, duplicate, ignored, …)  200
//   missing or wrong signature                400
//   body over the cap                         413
//   the gateway couldn't be asked             500: the gateway retries, and
//                                             the stored event is handled
//                                             again on the retry
//
// Every answer is `Cache-Control: no-store` with no body.

import type { Actor } from "@/server/actor";
import type { UseCases } from "@/server/app";
import { requestMeta } from "@/server/identity/request";
import type { ErrorReporter } from "@/server/ports/errors";

/** The largest body read. Razorpay's events are a few kilobytes. */
export const WEBHOOK_MAX_BYTES = 1_000_000;

const NO_STORE = { "Cache-Control": "no-store" };

function answer(status: number): Response {
  return new Response(null, { status, headers: NO_STORE });
}

/** Who a webhook acts as: a visitor, described by its request. */
export function webhookActor(headers: Headers): Actor {
  return { kind: "visitor", meta: requestMeta(headers) };
}

/** The body as text, or null once it passes `limit` bytes. */
async function readAtMost(
  request: Request,
  limit: number
): Promise<string | null> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function receiveWebhookRequest(
  app: Pick<UseCases, "receiveGatewayWebhook">,
  request: Request,
  errors: ErrorReporter
): Promise<Response> {
  const rawBody = await readAtMost(request, WEBHOOK_MAX_BYTES);
  if (rawBody === null) return answer(413);
  try {
    const result = await app.receiveGatewayWebhook({
      rawBody,
      headers: request.headers,
    });
    return answer(result.ok ? 200 : 400);
  } catch (error) {
    errors.report(error, { where: "webhooks.gateway" });
    return answer(500);
  }
}
