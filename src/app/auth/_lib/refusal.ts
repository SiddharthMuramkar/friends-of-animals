import "server-only";

import { redirect } from "next/navigation";

import { secondFactorPath } from "@/lib/second-factor-routes";
import { DomainError, errorSummaryForLogs } from "@/server/errors";

/**
 * Runs a factor operation at a Next.js boundary. With a return path, a
 * second-factor refusal redirects to the page that lifts it. Unexpected
 * errors reach runtime logging as a new error without query context.
 */
export async function orSecondFactor<T>(
  run: () => Promise<T>,
  next?: string
): Promise<T> {
  let path: string | null;
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof DomainError)) {
      throw new Error(
        `Second-factor operation failed: ${errorSummaryForLogs(error)}`
      );
    }
    path = next === undefined ? null : secondFactorPath(error.code, next);
    if (!path) throw error;
  }
  redirect(path);
}
