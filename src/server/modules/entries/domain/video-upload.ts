// Which videos an entry takes: common phone formats, a size limit and a
// length limit. The same check runs in the browser before anything is
// uploaded (with the length the browser reads from the file, when it can)
// and on the server when the upload starts. The media worker has the last
// word on length, from ffprobe, with the same rule (video-duration.ts).
//
// Browsers often report an empty type for .mov and .3gp files, so the file
// name's extension decides when the reported type says nothing.
//
// Pure: no I/O, no "server-only", so the upload form can import it.

import { isOverDuration } from "../../files/domain/video-duration";

export const VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/3gpp",
  "video/webm",
] as const;

export type VideoType = (typeof VIDEO_TYPES)[number];

export type VideoRule = {
  acceptedTypes: readonly VideoType[];
  maxBytes: number;
  maxDurationMs: number;
};

/** Videography until FOA sets its own limits: 200 MB and 3 minutes. */
export const DEFAULT_VIDEO_RULE: VideoRule = {
  acceptedTypes: VIDEO_TYPES,
  maxBytes: 200 * 1024 * 1024,
  maxDurationMs: 3 * 60 * 1000,
};

const EXTENSIONS: Readonly<Record<VideoType, readonly string[]>> = {
  "video/mp4": [".mp4", ".m4v"],
  "video/quicktime": [".mov"],
  "video/3gpp": [".3gp"],
  "video/webm": [".webm"],
};

const ALIASES: Readonly<Record<string, VideoType>> = {
  "video/x-m4v": "video/mp4",
};

/** Reported types that say nothing about the file. */
const UNINFORMATIVE = new Set(["", "application/octet-stream"]);

function typeFromExtension(name: string): VideoType | null {
  const lower = name.toLowerCase();
  return (
    VIDEO_TYPES.find((type) =>
      EXTENSIONS[type].some((extension) => lower.endsWith(extension))
    ) ?? null
  );
}

/**
 * The file's type: the reported one, normalised, or the one its extension
 * names when the reported type is empty or generic. Null if neither says.
 */
export function videoTypeOf(file: { name: string; type: string }) {
  const reported = file.type.split(";")[0]!.trim().toLowerCase();
  if (UNINFORMATIVE.has(reported)) return typeFromExtension(file.name);
  return ALIASES[reported] ?? reported;
}

export type VideoUploadCheck =
  | { ok: true; contentType: VideoType }
  | { ok: false; reason: "empty" | "wrong_type" | "too_large" | "too_long" };

/**
 * Checks one video against a rule: empty first, then type, size and
 * length. A length the browser couldn't read (null, NaN, Infinity) passes
 * here; the media worker measures it.
 */
export function checkVideoUpload(
  file: {
    name: string;
    type: string;
    size: number;
    durationMs?: number | null | undefined;
  },
  rule: VideoRule
): VideoUploadCheck {
  if (!Number.isInteger(file.size) || file.size < 1) {
    return { ok: false, reason: "empty" };
  }
  const type = videoTypeOf(file);
  const accepted = rule.acceptedTypes.find((candidate) => candidate === type);
  if (!accepted) return { ok: false, reason: "wrong_type" };
  if (file.size > rule.maxBytes) return { ok: false, reason: "too_large" };
  const durationMs =
    typeof file.durationMs === "number" && Number.isFinite(file.durationMs)
      ? file.durationMs
      : null;
  if (isOverDuration(durationMs, rule.maxDurationMs)) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, contentType: accepted };
}

/** The file input's `accept` value: the types, then their extensions. */
export function videoAcceptAttribute(rule: VideoRule): string {
  return [
    ...rule.acceptedTypes,
    ...rule.acceptedTypes.flatMap((type) => EXTENSIONS[type]),
  ].join(",");
}
