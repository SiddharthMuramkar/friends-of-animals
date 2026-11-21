import type { Actor } from "../actor";
import type { Deps } from "../deps";
import { errorSummaryForLogs } from "../errors";
import { isLiveSession } from "../modules/second-factor/session-lifetimes";
import { authFor } from "./auth";
import { requestMeta } from "./request";

/**
 * Who is making a request: the signed-in user if its session cookie is
 * valid and the session hasn't expired or been ended, else a visitor.
 * Edges call it through `currentActor()`; Seam 1 through the harness.
 */
export async function resolveActor(
  deps: Deps,
  headers: Headers
): Promise<Actor> {
  const meta = requestMeta(headers);
  try {
    const found = await authFor(deps).api.getSession({
      headers,
      // A Server Component can't set cookies, so never extend a session
      // while rendering: the cookie and the database would disagree.
      query: { disableRefresh: true },
    });
    if (!found) return { kind: "visitor", meta };
    // Staff sessions end 12 hours after sign-in (#60), even if a stored
    // expiry says later.
    const live = await isLiveSession(
      deps.db,
      {
        userId: found.user.id,
        createdAt: found.session.createdAt,
        expiresAt: found.session.expiresAt,
      },
      deps.clock.now()
    );
    return live
      ? {
          kind: "user",
          userId: found.user.id,
          sessionId: found.session.id,
          meta,
        }
      : { kind: "visitor", meta };
  } catch (error) {
    // Session and lifetime queries can include tokens or user IDs in their
    // errors. Next logs what a render throws, so only keep the safe summary.
    throw new Error(`Session lookup failed: ${errorSummaryForLogs(error)}`);
  }
}
