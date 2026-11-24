// One student's consent at a glance, for the coordinator dashboard: how the
// latest link stands and how many of the offered public uses a guardian has
// given. Participation and judging are covered by the institution's
// declaration, so they are not part of this summary.
//
// Loads under plain Node (the seed script): relative imports only.

import type { LinkStatus } from "./link";

/** The current consent to one offered public use. */
export type UseState<Purpose extends string = string> = {
  purpose: Purpose;
  status: "never" | "given" | "withdrawn";
};

export type PublicUseSummary = "none" | "some" | "all";

export type StudentConsentStatus<Purpose extends string = string> = {
  /** The newest link's status, or "not_sent" before the first one. */
  link: LinkStatus | "not_sent";
  publicUse: PublicUseSummary;
  /** Offered uses given, in the offered order. */
  given: Purpose[];
  /**
   * Whether the coordinator may send a link now: a first one, a replacement,
   * or a new one after an answer so the guardian can change it. Not while a
   * guardian is verified and answering.
   */
  canSendLink: boolean;
};

export function studentConsentStatus<Purpose extends string>(
  latestLink: LinkStatus | null,
  uses: readonly UseState<Purpose>[]
): StudentConsentStatus<Purpose> {
  const link = latestLink ?? "not_sent";
  const given = uses
    .filter((use) => use.status === "given")
    .map((use) => use.purpose);
  const publicUse: PublicUseSummary =
    given.length === 0 ? "none" : given.length === uses.length ? "all" : "some";
  return { link, publicUse, given, canSendLink: link !== "verified" };
}
