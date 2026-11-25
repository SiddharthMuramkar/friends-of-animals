// Which files an entry takes: types, a size limit and, for a video, a
// length limit, per kind of file (#85, #86). The same check runs in the
// browser, before anything is uploaded, and on the server when the upload
// starts and again when it completes. A video's length is checked from
// what the browser could read; worker-media has the last word, from
// ffprobe, by the same rule (../../files/domain/video-duration.ts).
//
// Browsers often report an empty or generic type for HEIC photos and for
// .mov and .3gp clips, so the file name's extension decides when the
// reported type says nothing.
//
// Pure: no I/O, no "server-only", so the upload form can import it.

import { PURPOSE_RULES } from "../../files/domain/purposes";
import { isOverDuration } from "../../files/domain/video-duration";

export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/** Common phone video formats (#86). */
export const VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/3gpp",
  "video/webm",
] as const;

/** An essay uploaded as a document (#86). */
export const DOCUMENT_TYPES = ["application/pdf"] as const;

export type AcceptedType =
  | (typeof IMAGE_TYPES)[number]
  | (typeof VIDEO_TYPES)[number]
  | (typeof DOCUMENT_TYPES)[number];

/** What an uploaded entry file is, as its rule says. */
export type UploadKind = "image" | "video" | "document";

export type UploadRule = {
  kind: UploadKind;
  acceptedTypes: readonly AcceptedType[];
  maxBytes: number;
  /** A video's longest clip; a file of another kind has none. */
  maxDurationMs?: number;
};

/**
 * Drawing, painting, art, craft and photography until FOA sets its own
 * limits (HR-37): phone and scanner photos up to 20 MB.
 */
export const DEFAULT_IMAGE_RULE: UploadRule = {
  kind: "image",
  acceptedTypes: IMAGE_TYPES,
  maxBytes: 20 * 1024 * 1024,
};

/**
 * Videography until FOA sets its own limits (HR-37): 200 MB and 3 minutes,
 * the entry_video purpose's own limits.
 */
export const DEFAULT_VIDEO_RULE: UploadRule = {
  kind: "video",
  acceptedTypes: VIDEO_TYPES,
  maxBytes: PURPOSE_RULES.entry_video.maxBytes,
  maxDurationMs: PURPOSE_RULES.entry_video.maxDurationMs,
};

/** An essay as a PDF until FOA sets its own limits (HR-37): 10 MB. */
export const DEFAULT_DOCUMENT_RULE: UploadRule = {
  kind: "document",
  acceptedTypes: DOCUMENT_TYPES,
  maxBytes: PURPOSE_RULES.entry_document.maxBytes,
};

const EXTENSIONS: Readonly<Record<AcceptedType, readonly string[]>> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
  "video/mp4": [".mp4", ".m4v"],
  "video/quicktime": [".mov"],
  "video/3gpp": [".3gp"],
  "video/webm": [".webm"],
  "application/pdf": [".pdf"],
};

const ALIASES: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
  "video/x-m4v": "video/mp4",
};

/** Reported types that say nothing about the file. */
const UNINFORMATIVE = new Set(["", "application/octet-stream"]);

const ALL_TYPES = Object.keys(EXTENSIONS) as AcceptedType[];

function typeFromExtension(name: string): AcceptedType | null {
  const lower = name.toLowerCase();
  return (
    ALL_TYPES.find((type) =>
      EXTENSIONS[type].some((extension) => lower.endsWith(extension))
    ) ?? null
  );
}

/**
 * The file's type: the reported one, normalised, or the one its extension
 * names when the reported type is empty or generic. Null if neither says.
 */
export function uploadTypeOf(file: { name: string; type: string }) {
  const reported = file.type.split(";")[0]!.trim().toLowerCase();
  if (UNINFORMATIVE.has(reported)) return typeFromExtension(file.name);
  return ALIASES[reported] ?? reported;
}

export type UploadRefusalReason =
  | "empty"
  | "wrong_type"
  | "too_large"
  | "too_long";

export type UploadCheck =
  | { ok: true; contentType: AcceptedType }
  | { ok: false; reason: UploadRefusalReason };

/**
 * Checks one file against a rule: empty first, then type, size and, for a
 * video, length. A length the browser couldn't read (null, NaN, Infinity:
 * Chrome and Firefox can't read HEVC) passes here; worker-media measures it.
 */
export function checkUpload(
  file: {
    name: string;
    type: string;
    size: number;
    durationMs?: number | null | undefined;
  },
  rule: UploadRule
): UploadCheck {
  if (!Number.isInteger(file.size) || file.size < 1) {
    return { ok: false, reason: "empty" };
  }
  const type = uploadTypeOf(file);
  const accepted = rule.acceptedTypes.find((candidate) => candidate === type);
  if (!accepted) return { ok: false, reason: "wrong_type" };
  if (file.size > rule.maxBytes) return { ok: false, reason: "too_large" };
  const durationMs =
    typeof file.durationMs === "number" && Number.isFinite(file.durationMs)
      ? file.durationMs
      : null;
  if (
    rule.maxDurationMs !== undefined &&
    isOverDuration(durationMs, rule.maxDurationMs)
  ) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, contentType: accepted };
}

/** The file input's `accept` value: the types, then their extensions. */
export function acceptAttribute(rule: UploadRule): string {
  return [
    ...rule.acceptedTypes,
    ...rule.acceptedTypes.flatMap((type) => EXTENSIONS[type]),
  ].join(",");
}
