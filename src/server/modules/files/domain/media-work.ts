// Which clean files get derived copies, of which kinds, and where those
// copies are stored. A module whose uploads need derivatives adds its
// purpose to IMAGE_DERIVATIVES (85a owns this registry; #85's entries,
// #86 video, #102 stamping, #103 gallery and #129 adoption append to it).
// A file with no kinds here gets no media job at all.
//
// Pure: no I/O, no "server-only".

import type { DerivativeKind } from "./derivatives";
import type { SniffedImageType } from "./image-type";
import { normaliseContentType, type FilePurpose } from "./purposes";

/** The derived copies each purpose's images get. */
export const IMAGE_DERIVATIVES: {
  readonly [P in FilePurpose]?: readonly DerivativeKind[];
} = {
  /** The demo upload page shows the thumbnail; a preview proves the job. */
  test_upload: ["thumb_320", "display_1600"],
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

/** "" or one lower-case folder ending in "/", as storage-key.ts makes. */
const PREFIX = /^(?:[a-z0-9-]+\/)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `<prefix>derived/<fileId>/<kind>.webp`: one folder per file, so deleting
 * a file's derivatives is one deletePrefix. Built only from the prefix,
 * the file's UUID and the kind, never from anything the uploader sent.
 */
export function derivativeKeyFor({
  prefix,
  fileId,
  kind,
}: {
  prefix: string;
  fileId: string;
  kind: DerivativeKind;
}): string {
  if (!PREFIX.test(prefix)) {
    throw new Error(`Not a storage prefix: ${JSON.stringify(prefix)}`);
  }
  if (!UUID.test(fileId)) {
    throw new Error(`Not a file id: ${JSON.stringify(fileId)}`);
  }
  return `${prefix}derived/${fileId}/${kind}.webp`;
}
