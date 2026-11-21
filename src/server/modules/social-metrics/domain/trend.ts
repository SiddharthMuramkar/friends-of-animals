// The social report (#135): snapshots summed up over a period and drawn as
// a trend. Followers is a level, so a period's figure is the last count by
// its end, set against the last count before it began (or the first one
// inside it, for a channel that started being tracked mid-period). The
// activity counts are flows, so a period adds up the snapshots dated in it.
// An unreported figure is counted as missing, never as zero, and the
// engagement rate (engagements / impressions) is only given when every
// snapshot in the period reported both.
//
// Pure: relative imports only.

import {
  compareWithPrevious,
  percentOf,
  type Comparison,
} from "../../objective-reports/domain/figures";
import {
  granularityFor,
  splitPeriod,
  type Granularity,
  type ResolvedPeriod,
} from "../../objective-reports/domain/period";
import { SOCIAL_CHANNELS, type SocialChannel } from "./snapshot";

/** One stored snapshot, as the report reads it. */
export type SocialSnapshot = {
  channel: SocialChannel;
  /** `YYYY-MM-DD`, IST. */
  recordedFor: string;
  followers: number;
  posts: number;
  reach: number | null;
  impressions: number | null;
  engagements: number | null;
};

/** A flow over a period: the reported sum, and how many didn't report. */
export type FlowTotal = {
  /** Null when no snapshot in the period reported it. */
  total: number | null;
  /** Snapshots in the period that left it unreported. */
  missing: number;
};

export type SocialFigures = {
  /** Snapshots dated inside the period. */
  snapshots: number;
  /** Followers by the period's end against its start; null if untracked. */
  followers: Comparison | null;
  posts: FlowTotal;
  reach: FlowTotal;
  impressions: FlowTotal;
  engagements: FlowTotal;
  /** Engagements as a percentage of impressions, to 0.1. */
  engagementRate: number | null;
};

export type SocialSummary = {
  /** Channels with a snapshot on or before the period's end. */
  channels: (SocialFigures & { channel: SocialChannel })[];
  total: SocialFigures;
};

type Span = { from: string; to: string };

const NO_FLOW: FlowTotal = { total: null, missing: 0 };

function flowOf(values: readonly (number | null)[]): FlowTotal {
  return values.reduce<FlowTotal>(
    (sum, value) =>
      value === null
        ? { ...sum, missing: sum.missing + 1 }
        : { ...sum, total: (sum.total ?? 0) + value },
    NO_FLOW
  );
}

function addFlows(a: FlowTotal, b: FlowTotal): FlowTotal {
  return {
    total:
      a.total === null
        ? b.total
        : b.total === null
          ? a.total
          : a.total + b.total,
    missing: a.missing + b.missing,
  };
}

function engagementRate(
  engagements: FlowTotal,
  impressions: FlowTotal
): number | null {
  if (engagements.missing > 0 || impressions.missing > 0) return null;
  if (engagements.total === null || impressions.total === null) return null;
  return percentOf(engagements.total, impressions.total);
}

function figures(
  snapshots: number,
  followers: Comparison | null,
  flows: Pick<SocialFigures, "posts" | "reach" | "impressions" | "engagements">
): SocialFigures {
  return {
    snapshots,
    followers,
    ...flows,
    engagementRate: engagementRate(flows.engagements, flows.impressions),
  };
}

/** Sums `snapshots` up over the days `span.from`..`span.to`. */
export function summariseSocialPeriod(
  snapshots: readonly SocialSnapshot[],
  span: Span
): SocialSummary {
  const ordered = [...snapshots].sort((a, b) =>
    a.recordedFor < b.recordedFor ? -1 : a.recordedFor > b.recordedFor ? 1 : 0
  );
  const channels: SocialSummary["channels"] = [];
  for (const channel of SOCIAL_CHANNELS) {
    const known = ordered.filter(
      (s) => s.channel === channel && s.recordedFor <= span.to
    );
    const end = known.at(-1);
    if (!end) continue;
    const inside = known.filter((s) => s.recordedFor >= span.from);
    const start =
      known.filter((s) => s.recordedFor < span.from).at(-1) ?? inside[0] ?? end;
    channels.push({
      channel,
      ...figures(
        inside.length,
        compareWithPrevious(end.followers, start.followers),
        {
          posts: flowOf(inside.map((s) => s.posts)),
          reach: flowOf(inside.map((s) => s.reach)),
          impressions: flowOf(inside.map((s) => s.impressions)),
          engagements: flowOf(inside.map((s) => s.engagements)),
        }
      ),
    });
  }
  const sum = (key: "posts" | "reach" | "impressions" | "engagements") =>
    channels.reduce((total, row) => addFlows(total, row[key]), NO_FLOW);
  const total = figures(
    channels.reduce((n, row) => n + row.snapshots, 0),
    channels.length === 0
      ? null
      : compareWithPrevious(
          channels.reduce((n, row) => n + row.followers!.current, 0),
          channels.reduce((n, row) => n + row.followers!.previous, 0)
        ),
    {
      posts: sum("posts"),
      reach: sum("reach"),
      impressions: sum("impressions"),
      engagements: sum("engagements"),
    }
  );
  return { channels, total };
}

export type SocialTrend = {
  granularity: Granularity;
  /** One summary per week or month of the period, oldest first. */
  buckets: (Span & SocialSummary)[];
};

/** The period's summary, week by week (up to 92 days) or month by month. */
export function socialTrend(
  snapshots: readonly SocialSnapshot[],
  period: ResolvedPeriod
): SocialTrend {
  const granularity = granularityFor(period.days);
  return {
    granularity,
    buckets: splitPeriod(period, granularity).map((span) => ({
      ...span,
      ...summariseSocialPeriod(snapshots, span),
    })),
  };
}
