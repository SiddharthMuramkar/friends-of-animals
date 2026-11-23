import "server-only";

import { orSecondFactor } from "@/app/auth/_lib/refusal";

import { isRefusal } from "./refusal";

/**
 * Runs an admin use case at a page or Server Action boundary (#59).
 * - A policy refusal comes back as `{ ok: false }`, for the page to explain.
 * - A second-factor refusal redirects to the page that lifts it, then back
 *   to `next`.
 * - Anything unexpected is thrown again as a new error naming only its
 *   class and Postgres code. Next logs what a boundary throws, and a failed
 *   query's error lists its bound values: search text, names, addresses.
 */
export async function adminCall<T>(
  run: () => Promise<T>,
  next: string
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await orSecondFactor(run, next) };
  } catch (error) {
    if (isRefusal(error)) return { ok: false };
    throw error;
  }
}
