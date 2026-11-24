// The donate page's read of the donation terms (#106), cached under
// DONATION_TERMS_TAG: changing a donations.* setting refreshes it. The
// page reads it at request time, inside <Live>, so the build needs no
// database; a failed read says giving is closed, and is retried in 15
// seconds.

import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { as } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import {
  FAILED_READ_SHELL_LIFE,
  PUBLIC_READER,
} from "@/server/modules/cms/cached";
import {
  CLOSED_TERMS,
  DONATION_TERMS_TAG,
  type DonationTerms,
} from "@/server/modules/donations/terms";

export async function loadDonationTerms(): Promise<DonationTerms> {
  "use cache";
  cacheTag(DONATION_TERMS_TAG);
  try {
    const terms = await as(PUBLIC_READER).getDonationTerms();
    cacheLife("hours");
    return terms;
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      `Donate page: could not read the terms: ${errorSummaryForLogs(error)}`
    );
    cacheLife(FAILED_READ_SHELL_LIFE);
    return CLOSED_TERMS;
  }
}
