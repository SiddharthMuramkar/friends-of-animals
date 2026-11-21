// A social-media metric snapshot (#135): what one FOA channel showed on one
// day, typed in by a content manager (FOA posts by hand; no platform APIs).
// Followers is the count on that day. Posts, reach, impressions and
// engagements are the activity since the channel's previous snapshot, so
// monthly snapshots add up to quarters and years. Reach, impressions and
// engagements may be left unreported: not every platform shows each one,
// and a zero would drag the engagement rate down.
//
// Loads under plain Node (the schema builds its enum from SOCIAL_CHANNELS):
// relative imports only, no "server-only".

import { z } from "zod";

import {
  isCalendarDay,
  istDateOf,
} from "../../objective-reports/domain/period";

/** FOA's channels, in the order reports list them. */
export const SOCIAL_CHANNELS = [
  "instagram",
  "facebook",
  "youtube",
  "x",
  "linkedin",
  "other",
] as const;

export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

/** The largest count a Postgres `integer` column holds. */
export const MAX_METRIC = 2_147_483_647;

const count = z.int().min(0).max(MAX_METRIC);

/**
 * The input to record or correct a snapshot. `recordedFor` is a calendar
 * day in IST and may not be after today (`in_future`); earlier days are
 * fine, so past months can be filled in.
 */
export function socialSnapshotInput(now: Date) {
  const today = istDateOf(now);
  return z.strictObject({
    channel: z.enum(SOCIAL_CHANNELS),
    recordedFor: z.iso.date().refine(
      // A malformed day is the format check's to report, not this one's.
      (day) => !isCalendarDay(day) || day <= today,
      { message: "in_future" }
    ),
    followers: count,
    posts: count,
    reach: count.nullable(),
    impressions: count.nullable(),
    engagements: count.nullable(),
  });
}

export type SocialSnapshotInput = z.infer<
  ReturnType<typeof socialSnapshotInput>
>;
