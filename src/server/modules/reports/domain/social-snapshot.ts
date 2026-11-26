// A content manager records FOA's aggregate platform metrics by channel
// and observation date; no handles, audience identity or tracking data.
import { z } from "zod";
import { istDateOf } from "../../ledger/domain/period";

export const SOCIAL_CHANNELS = [
  "instagram",
  "facebook",
  "youtube",
  "x",
  "linkedin",
  "other",
] as const;
export const SOCIAL_METRICS = [
  "followers",
  "posts",
  "reach",
  "impressions",
  "engagements",
] as const;
export const MAX_METRIC = 2_147_483_647;
const count = z.int().min(0).max(MAX_METRIC);

export function socialSnapshotInput(now: Date) {
  return z.strictObject({
    channel: z.enum(SOCIAL_CHANNELS),
    recordedFor: z.iso
      .date()
      .refine((day) => day <= istDateOf(now), { message: "future_date" }),
    followers: count,
    posts: count,
    reach: count.nullable(),
    impressions: count.nullable(),
    engagements: count.nullable(),
  });
}
export type SocialSnapshotInput = z.input<
  ReturnType<typeof socialSnapshotInput>
>;
export type SocialSnapshot = SocialSnapshotInput & {
  followerChange: number | null;
};
