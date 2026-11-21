import "server-only";

import { redirect } from "next/navigation";

import { secondFactorPath } from "@/lib/second-factor-routes";
import { DomainError } from "@/server/errors";

/**
 * Runs a use case; if it refuses for want of a second factor, sends the
 * user to the page that lifts the refusal, then back to `next`. Any other
 * error is thrown on.
 */
export async function orSecondFactor<T>(
  run: () => Promise<T>,
  next: string
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DomainError) {
      const path = secondFactorPath(error.code, next);
      if (path) redirect(path);
    }
    throw error;
  }
}
