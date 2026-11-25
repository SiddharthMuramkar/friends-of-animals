"use server";
import { redirect, RedirectType } from "next/navigation";
import { ADMIN_SOCIAL_METRICS } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import {
  SOCIAL_METRICS,
  type SocialSnapshotInput,
} from "@/server/modules/reports/domain/social-snapshot";
import {
  resolvePeriod,
  type ObjectivePeriodInput,
} from "@/server/modules/reports/domain/period";
import { adminCall } from "../../_lib/boundary";

export async function recordSocialAction(
  period: ObjectivePeriodInput,
  data: FormData
) {
  const actor = await currentActor();
  const text = (key: string) => {
    const value = data.get(key);
    return typeof value === "string" ? value : "";
  };
  // Reject blanks for required counts, and non-integer browser/API input.
  const numeric = (key: (typeof SOCIAL_METRICS)[number]) => {
    const value = text(key);
    if (!value) return key === "followers" || key === "posts" ? NaN : null;
    return /^\d+$/.test(value) ? Number(value) : NaN;
  };
  const channel = text("channel");
  const recordedFor = text("recordedFor");
  const result = await adminCall(
    () =>
      as(actor).recordSocialSnapshot({
        channel: channel as SocialSnapshotInput["channel"],
        recordedFor,
        followers: numeric("followers") as number,
        posts: numeric("posts") as number,
        reach: numeric("reach"),
        impressions: numeric("impressions"),
        engagements: numeric("engagements"),
      }),
    ADMIN_SOCIAL_METRICS
  );
  const done = !result.ok
    ? "forbidden"
    : result.value.ok
      ? result.value.outcome
      : "invalidInput";
  const selected = resolvePeriod(period).ok
    ? period
    : { from: recordedFor, to: recordedFor };
  const next =
    result.ok && result.value.ok
      ? {
          from: recordedFor < selected.from ? recordedFor : selected.from,
          to: recordedFor > selected.to ? recordedFor : selected.to,
        }
      : selected;
  redirect(
    `${ADMIN_SOCIAL_METRICS}?${new URLSearchParams({ ...next, done })}`,
    RedirectType.replace
  );
}
