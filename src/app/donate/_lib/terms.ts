// The donate page's reads of the donation terms (#106). The page shows
// them through <Live>: `publishedDonationTerms` is the cached read the
// static shell holds once the server regenerates the page (null while
// `next build` prerenders, or when it can't read), and
// `currentDonationTerms` the fresh read that streams into the shell
// otherwise. Changing a donations.* setting refreshes the cached one
// (DONATION_TERMS_TAG). A failed read says giving is closed.

import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { as } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import { isNextBuild, PUBLIC_READER } from "@/server/modules/cms/cached";
import {
  CLOSED_TERMS,
  DONATION_TERMS_TAG,
  type DonationTerms,
} from "@/server/modules/donations/terms";

export async function publishedDonationTerms(): Promise<DonationTerms | null> {
  "use cache";
  cacheTag(DONATION_TERMS_TAG);
  cacheLife("hours");
  if (isNextBuild()) return null;
  try {
    return await as(PUBLIC_READER).getDonationTerms();
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      `Donate page: could not read the terms: ${errorSummaryForLogs(error)}`
    );
    return null;
  }
}

export async function currentDonationTerms(): Promise<DonationTerms> {
  try {
    return await as(PUBLIC_READER).getDonationTerms();
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      `Donate page: could not read the terms: ${errorSummaryForLogs(error)}`
    );
    return CLOSED_TERMS;
  }
}
