// How the media worker turns an uploaded video into the copy people watch:
// an H.264 + AAC MP4 that starts playing before it has fully downloaded,
// no bigger than 1080p, and a JPEG poster. The original stays private.
//
// Nothing from the original's metadata survives: no location (iPhones
// write com.apple.quicktime.location.ISO6709), no creation time, no camera
// make or model, no chapters, no subtitle or data streams (timed metadata
// tracks carry GPS too), and no encoder name.
//
// The plan is the one source of truth for sizes and the length rule: the
// ffmpeg adapter runs these argument lists, and the in-memory fake reports
// the same plan, so the two can't drift apart.
//
// Pure: builds argument lists, runs nothing.

import { DURATION_TOLERANCE_MS, isOverDuration } from "./video-duration";
import type { VideoProbe } from "./video-probe";

export const TRANSCODE_PROFILE = {
  /** The longer side of the box the video fits into. */
  maxLongEdge: 1920,
  maxShortEdge: 1080,
  crf: 23,
  /** Fast, because the worker shares its CPUs with the production database. */
  preset: "veryfast",
  audioBitrate: "128k",
  audioSampleRate: 48_000,
  posterMaxEdge: 1280,
} as const;

export type VideoTranscodePlan = {
  /** Output size, both even (H.264 with yuv420p needs that). */
  width: number;
  height: number;
  posterWidth: number;
  posterHeight: number;
  /** Where the poster frame is taken from, in seconds. */
  posterAtS: number;
  /** Output length cap, in seconds: a backstop if the container lies. */
  maxOutputS: number;
  /** False when ffprobe couldn't read the length. */
  durationKnown: boolean;
  hasAudio: boolean;
  /** How long the adapter lets ffmpeg run before killing it. */
  timeoutMs: number;
};

export type VideoTranscodeDecision =
  | { ok: true; plan: VideoTranscodePlan }
  | { ok: false; reason: "too_long" };

function evenAtMost(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

export function planVideoTranscode(
  probe: VideoProbe,
  limits: { maxDurationMs: number }
): VideoTranscodeDecision {
  if (isOverDuration(probe.durationMs, limits.maxDurationMs)) {
    return { ok: false, reason: "too_long" };
  }
  const { width, height, durationMs } = probe;
  const landscape = width >= height;
  const boxWidth = landscape
    ? TRANSCODE_PROFILE.maxLongEdge
    : TRANSCODE_PROFILE.maxShortEdge;
  const boxHeight = landscape
    ? TRANSCODE_PROFILE.maxShortEdge
    : TRANSCODE_PROFILE.maxLongEdge;
  const scale = Math.min(1, boxWidth / width, boxHeight / height);
  const posterScale = Math.min(
    1,
    TRANSCODE_PROFILE.posterMaxEdge / Math.max(width, height)
  );
  const workMs = durationMs ?? limits.maxDurationMs;
  return {
    ok: true,
    plan: {
      width: evenAtMost(Math.round(width * scale)),
      height: evenAtMost(Math.round(height * scale)),
      posterWidth: Math.max(1, Math.round(width * posterScale)),
      posterHeight: Math.max(1, Math.round(height * posterScale)),
      posterAtS: durationMs === null ? 0 : Math.min(1, durationMs / 2000),
      maxOutputS: (limits.maxDurationMs + DURATION_TOLERANCE_MS) / 1000,
      durationKnown: durationMs !== null,
      hasAudio: probe.audioCodec !== null,
      timeoutMs: Math.max(120_000, 4 * workMs) + 60_000,
    },
  };
}

/** A path ffmpeg would read as an option is refused, never escaped. */
function checkPath(path: string): string {
  if (path === "" || path.startsWith("-")) {
    throw new RangeError(`Refusing ffmpeg path ${JSON.stringify(path)}`);
  }
  return path;
}

const STRIP_METADATA = ["-map_metadata", "-1", "-fflags", "+bitexact"];

/** ffmpeg's arguments for the watchable copy. Autorotate stays on. */
export function transcodeArgs(
  input: string,
  output: string,
  plan: VideoTranscodePlan
): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-i",
    checkPath(input),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-t",
    String(plan.maxOutputS),
    "-vf",
    `scale=${plan.width}:${plan.height}`,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    TRANSCODE_PROFILE.preset,
    "-crf",
    String(TRANSCODE_PROFILE.crf),
    "-c:a",
    "aac",
    "-b:a",
    TRANSCODE_PROFILE.audioBitrate,
    "-ar",
    String(TRANSCODE_PROFILE.audioSampleRate),
    "-ac",
    "2",
    ...STRIP_METADATA,
    "-map_chapters",
    "-1",
    "-sn",
    "-dn",
    "-flags:v",
    "+bitexact",
    "-flags:a",
    "+bitexact",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    checkPath(output),
  ];
}

/** ffmpeg's arguments for the poster: one JPEG frame. */
export function posterArgs(
  input: string,
  output: string,
  plan: VideoTranscodePlan
): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-ss",
    String(plan.posterAtS),
    "-i",
    checkPath(input),
    "-map",
    "0:v:0",
    "-frames:v",
    "1",
    "-vf",
    `scale=${plan.posterWidth}:${plan.posterHeight}`,
    ...STRIP_METADATA,
    "-flags:v",
    "+bitexact",
    "-c:v",
    "mjpeg",
    "-q:v",
    "3",
    "-f",
    "image2",
    checkPath(output),
  ];
}
