// The media processor port: image bytes in, derived copies out. It makes the
// sizes planImageDerivatives() plans, as WebP, with the orientation baked
// into the pixels and no metadata at all (no EXIF location or camera, no
// XMP, no IPTC), because participants are often children and a photo's GPS
// is a safeguarding leak. It never touches storage or the database: the
// Files module's media job reads the original and writes the derivatives
// (src/server/modules/files).
//
// Adapters:
//   - sharp (./media-sharp.ts): prebuilt sharp, with HEIC decoded by WASM
//     libheif first. Runs in worker-media, and in Vitest without Docker.
//   - the in-memory fake (src/test/fakes/media.ts): Seam 1 tests.
// Both pass ./media.contract.ts.
//
// Loads under plain Node (the worker): relative imports only.

import type {
  DerivativeKind,
  PixelSize,
  PlannedDerivative,
} from "../modules/files/domain/derivatives";
import type { SniffedImageType } from "../modules/files/domain/image-type";

export type MediaInput = {
  /** The whole original, as uploaded. */
  bytes: Uint8Array;
  /** The derived copies to make, each once. */
  kinds: readonly DerivativeKind[];
};

export type MediaDerivative = PlannedDerivative & { bytes: Uint8Array };

export type MediaResult = {
  /** What the bytes are, whatever type the upload declared. */
  sniffedType: SniffedImageType;
  /**
   * The stored pixel size and the EXIF orientation still to apply, as
   * planImageDerivatives() takes them. HEIC carries its rotation in the
   * container, which the decoder applies, so it reports no orientation.
   */
  source: PixelSize & { orientation?: number };
  /** One per kind asked for, in that order. */
  derivatives: MediaDerivative[];
};

export interface MediaProcessor {
  /** Rejects with a MediaError when the bytes can't be processed. */
  processImage(input: MediaInput): Promise<MediaResult>;
}

/**
 * Why an image couldn't be processed. Each code is safe to store and to
 * show staff; none carries the file's content.
 */
export type MediaErrorCode =
  /** Not a JPEG, PNG, WebP, HEIC or HEIF (GIF, AVIF, PDF, text...). */
  | "unsupported_type"
  /** It claims to be an image we take, but its pixels don't decode. */
  | "media_decode_failed"
  /** More pixels than the processor will decode (a decompression bomb). */
  | "image_too_large";

export const MEDIA_ERROR_CODES = [
  "unsupported_type",
  "media_decode_failed",
  "image_too_large",
] as const satisfies readonly MediaErrorCode[];

export class MediaError extends Error {
  readonly code: MediaErrorCode;

  constructor(code: MediaErrorCode, options?: { cause?: unknown }) {
    super(MEDIA_ERROR_MESSAGES[code], options);
    this.name = "MediaError";
    this.code = code;
  }
}

const MEDIA_ERROR_MESSAGES: Record<MediaErrorCode, string> = {
  unsupported_type: "The file is not an image type the platform processes",
  media_decode_failed: "The image could not be decoded",
  image_too_large: "The image has more pixels than the platform processes",
};

/** The most pixels an adapter decodes by default: 100 megapixels. */
export const DEFAULT_MAX_INPUT_PIXELS = 100_000_000;
