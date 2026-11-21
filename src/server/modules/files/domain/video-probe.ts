// What the media worker learns about a video from ffprobe
// (`ffprobe -v error -show_format -show_streams -of json`), reduced to what
// planning a transcode needs: the length, the size the clip shows at once
// its rotation is applied, and the codecs. Metadata such as location and
// creation time is read past, never kept.
//
// Pure: parses ffprobe's JSON, runs nothing.

import { z } from "zod";

export { DURATION_TOLERANCE_MS, isOverDuration } from "./video-duration";

export type VideoProbe = {
  /** Null when neither the container nor the video stream says. */
  durationMs: number | null;
  /** The upright size: width and height swap for a quarter turn. */
  width: number;
  height: number;
  /** Clockwise degrees the player turns the picture: 0, 90, 180 or 270. */
  rotation: 0 | 90 | 180 | 270;
  videoCodec: string;
  audioCodec: string | null;
  formatName: string | null;
};

export type VideoProbeResult =
  | { ok: true; probe: VideoProbe }
  | { ok: false; reason: "no_video_stream" | "unreadable" };

const seconds = z.union([z.string(), z.number()]).optional();

const streamSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: seconds,
  disposition: z.object({ attached_pic: z.number().optional() }).optional(),
  tags: z.record(z.string(), z.unknown()).optional(),
  side_data_list: z
    .array(
      z.object({
        side_data_type: z.string().optional(),
        rotation: z.number().optional(),
      })
    )
    .optional(),
});

const ffprobeSchema = z.object({
  streams: z.array(streamSchema),
  format: z
    .object({ format_name: z.string().optional(), duration: seconds })
    .optional(),
});

type Stream = z.infer<typeof streamSchema>;

function toMilliseconds(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 1000)
    : null;
}

function isPositiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

/**
 * The display rotation. Newer ffprobe reports a display matrix whose
 * rotation is counter-clockwise; older ones a clockwise `rotate` tag.
 */
function rotationOf(stream: Stream): VideoProbe["rotation"] {
  const matrix = stream.side_data_list?.find(
    (side) => side.rotation !== undefined
  )?.rotation;
  const degrees =
    matrix !== undefined ? -matrix : Number(stream.tags?.["rotate"] ?? 0);
  if (!Number.isFinite(degrees)) return 0;
  const quarterTurns = (((Math.round(degrees / 90) % 4) + 4) % 4) as
    | 0
    | 1
    | 2
    | 3;
  return ([0, 90, 180, 270] as const)[quarterTurns];
}

export function parseFfprobeOutput(output: unknown): VideoProbeResult {
  const parsed = ffprobeSchema.safeParse(output);
  if (!parsed.success) return { ok: false, reason: "unreadable" };
  const { streams, format } = parsed.data;

  // Cover art is stored as a one-frame video stream; it isn't the video.
  const video = streams.find(
    (stream) =>
      stream.codec_type === "video" && stream.disposition?.attached_pic !== 1
  );
  if (!video) return { ok: false, reason: "no_video_stream" };
  if (!isPositiveInteger(video.width) || !isPositiveInteger(video.height)) {
    return { ok: false, reason: "unreadable" };
  }

  const rotation = rotationOf(video);
  const quarterTurn = rotation === 90 || rotation === 270;
  const audio = streams.find((stream) => stream.codec_type === "audio");
  return {
    ok: true,
    probe: {
      durationMs:
        toMilliseconds(format?.duration) ?? toMilliseconds(video.duration),
      width: quarterTurn ? video.height : video.width,
      height: quarterTurn ? video.width : video.height,
      rotation,
      videoCodec: video.codec_name ?? "unknown",
      audioCodec: audio?.codec_name ?? null,
      formatName: format?.format_name ?? null,
    },
  };
}
