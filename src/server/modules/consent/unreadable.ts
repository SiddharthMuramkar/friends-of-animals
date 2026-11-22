// For pages that must render even when the database can't be read: the
// legal pages fall back to the repo's text, and the sign-up form leaves out
// its optional messages box.

import { unstable_rethrow } from "next/navigation";

import { errorSummaryForLogs } from "../../errors";

/**
 * `read()`, or null if it throws, as if nothing were published. The error
 * is logged under `where`. Next's own control-flow errors (a prerender
 * bail-out, a redirect) pass through.
 */
export async function nullIfUnreadable<T>(
  where: string,
  read: () => Promise<T | null>
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    unstable_rethrow(error);
    console.error(`${where}: ${errorSummaryForLogs(error)}`);
    return null;
  }
}
