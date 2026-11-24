// Which clean files get derived copies, of which kinds, and where those
// copies are stored. A module whose uploads need derivatives adds its
// purpose to IMAGE_DERIVATIVES or VIDEO_DERIVATIVES (85a owns this
// registry; #85's entries, #86 video, #102 stamping, #103 gallery and #129
// adoption append to it). A file with no kinds here gets no media job at
// all: it is ready as soon as its scan passes (an essay's PDF, #86).
//
// Pure: no I/O, no "server-only".

import {
  derivativeExtension,
  type DerivativeKind,
  type StoredDerivativeKind,
  type VideoDerivativeKind,
} from "./derivatives";
import type { SniffedImageType } from "./image-type";
import {
  normaliseContentType,
  VIDEO_CONTENT_TYPES,
  type FilePurpose,
} from "./purposes";

/** The derived copies each purpose's images get. */
export const IMAGE_DERIVATIVES: {
  readonly [P in FilePurpose]?: readonly DerivativeKind[];
} = {
  /** Lets the test uploads prove the media job end to end (Seam 1, previews). */
  test_upload: ["thumb_320", "display_1600"],
  /** A post's images: only these copies are ever public (#112). */
  cms_image: ["post_cover_1200", "post_inline_960"],
  /**
   * An entry's picture (#85): the thumbnail on the participant's own
   * pages, the large copy for staff, verifiers and judges.
   */
  entry_image: ["thumb_320", "display_1600"],
};

/** The derived copies each purpose's videos get (#86). */
export const VIDEO_DERIVATIVES: {
  readonly [P in FilePurpose]?: readonly VideoDerivativeKind[];
} = {
  /** An entry's video: the copy people watch, and its poster. */
  entry_video: ["video_mp4", "video_poster"],
};

/** The stored types the media processor decodes. */
const IMAGE_TYPES: ReadonlySet<string> = new Set<SniffedImageType>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/**
 * The derivatives a clean file gets, by its purpose and stored type: none
 * for a type the media processor doesn't decode (a PDF) or a purpose that
 * registered none.
 */
export function derivativeKindsFor({
  purpose,
  contentType,
}: {
  purpose: FilePurpose;
  contentType: string;
}): readonly DerivativeKind[] {
  if (!IMAGE_TYPES.has(normaliseContentType(contentType))) return [];
  return Object.hasOwn(IMAGE_DERIVATIVES, purpose)
    ? (IMAGE_DERIVATIVES[purpose] ?? [])
    : [];
}

const VIDEO_TYPES: ReadonlySet<string> = new Set(VIDEO_CONTENT_TYPES);

/**
 * The derivatives a clean video gets, by its purpose and stored type: none
 * for a type that isn't a video or a purpose that registered none.
 */
export function videoDerivativeKindsFor({
  purpose,
  contentType,
}: {
  purpose: FilePurpose;
  contentType: string;
}): readonly VideoDerivativeKind[] {
  if (!VIDEO_TYPES.has(normaliseContentType(contentType))) return [];
  return Object.hasOwn(VIDEO_DERIVATIVES, purpose)
    ? (VIDEO_DERIVATIVES[purpose] ?? [])
    : [];
}

/**
 * The media job a clean file gets: an image's (sharp), a video's (ffmpeg),
 * or none, when it is ready as stored.
 */
export function mediaJobFor(file: {
  purpose: FilePurpose;
  contentType: string;
}): "image" | "video" | null {
  if (derivativeKindsFor(file).length > 0) return "image";
  if (videoDerivativeKindsFor(file).length > 0) return "video";
  return null;
}

/** "" or one lower-case folder ending in "/", as storage-key.ts makes. */
const PREFIX = /^(?:[a-z0-9-]+\/)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `<prefix>derived/<fileId>/<kind>.<ext>` (`.webp` for an image's copies,
 * `.mp4` and `.jpg` for a video's): one folder per file, so deleting a
 * file's derivatives is one deletePrefix. Built only from the prefix, the
 * file's UUID and the kind, never from anything the uploader sent.
 */
export function derivativeKeyFor({
  prefix,
  fileId,
  kind,
}: {
  prefix: string;
  fileId: string;
  kind: StoredDerivativeKind;
}): string {
  if (!PREFIX.test(prefix)) {
    throw new Error(`Not a storage prefix: ${JSON.stringify(prefix)}`);
  }
  if (!UUID.test(fileId)) {
    throw new Error(`Not a file id: ${JSON.stringify(fileId)}`);
  }
  return `${prefix}derived/${fileId}/${kind}.${derivativeExtension(kind)}`;
}
