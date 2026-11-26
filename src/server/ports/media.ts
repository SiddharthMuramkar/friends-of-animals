// The media processor port: an original in, derived copies out. For an
// image it makes the sizes planImageDerivatives() plans, as WebP, with the
// orientation baked into the pixels; for a video (#86), the H.264 and AAC
// MP4 copy and JPEG poster planVideoTranscode() plans; for an essay PDF
// (#96), a freshly rendered, raster-only PDF. No derivative
// carries any metadata (no EXIF or QuickTime location, camera, creation
// time; no XMP, no IPTC), because participants are often children and a
// photo's or a clip's GPS is a safeguarding leak. It never touches storage
// or the database: the Files module's media jobs read the original and
// write the derivatives (src/server/modules/files).
//
// Adapters:
//   - sharp (./media-sharp.ts) for images: prebuilt sharp, with HEIC
//     decoded by WASM libheif first. Runs in worker-media, and in Vitest
//     without Docker.
//   - ffmpeg (./media-ffmpeg.ts) for videos: ffprobe and ffmpeg, which
//     only the worker-media image installs.
//   - Poppler (./media-pdf.ts) for essay PDFs: pdftoppm, installed only
//     in worker-media.
//   - the in-memory fake (src/test/fakes/media.ts): Seam 1 tests.
// Each passes ./media.contract.ts for what it handles; the real video and
// PDF adapter runs are *.media.test.ts (`pnpm test:media`).
//
// Loads under plain Node (the worker): relative imports only.

import type {
  DerivativeKind,
  PixelSize,
  PdfDerivativeKind,
  PlannedDerivative,
  VideoDerivativeKind,
} from "../modules/files/domain/derivatives";
import type { StampVariant } from "../modules/stamping/domain/variants";
import type { SniffedImageType } from "../modules/files/domain/image-type";
import type { VideoProbe } from "../modules/files/domain/video-probe";
import type { SniffedVideoType } from "../modules/files/domain/video-sniff";

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

export type VideoInput = {
  /** The whole original, streamed from storage. */
  source: ReadableStream<Uint8Array>;
  /** The longest clip taken, as ffprobe measures it (./video-duration.ts). */
  maxDurationMs: number;
};

export type VideoDerivative = {
  kind: VideoDerivativeKind;
  contentType: "video/mp4" | "image/jpeg";
  width: number;
  height: number;
  /** The copy's length; null for the poster, or when unknown. */
  durationMs: number | null;
  bytes: Uint8Array;
};

export type VideoResult = {
  /** What the bytes are, whatever type the upload declared. */
  sniffedType: SniffedVideoType;
  /** What ffprobe read: length, upright size and codecs, no metadata. */
  probe: VideoProbe;
  /** The watchable copy, then its poster. */
  derivatives: VideoDerivative[];
};

/** An image adapter's half of the port (sharp). */
export interface ImageProcessor {
  /** Rejects with a MediaError when the bytes can't be processed. */
  processImage(input: MediaInput): Promise<MediaResult>;
}

/** A video adapter's half of the port (ffmpeg, #86). */
export interface VideoProcessor {
  /**
   * The video's watchable copy and poster. Rejects with a MediaError when
   * the clip can't be taken (too long, no picture, undecodable, past its
   * deadline); anything else it throws is worth another try.
   */
  processVideo(input: VideoInput): Promise<VideoResult>;
}

/** An essay PDF rendered into a new, inert, raster-only PDF (#96). */
export type PdfDerivative = {
  kind: PdfDerivativeKind;
  contentType: "application/pdf";
  width: null;
  height: null;
  durationMs: null;
  bytes: Uint8Array;
};

export interface PdfProcessor {
  /** Rejects with a MediaError if no complete safe copy can be made. */
  processPdf(input: { bytes: Uint8Array }): Promise<PdfDerivative>;
}

export type StampImageInput = { bytes: Uint8Array; variant: StampVariant };
export type StampedImage = {
  bytes: Uint8Array;
  contentType: "image/png" | "image/webp";
  width: number;
  height: number;
};
export interface StampProcessor {
  /** A clean safe image derivative or private generated certificate PDF, never original artwork. */
  stampImage(input: StampImageInput): Promise<StampedImage>;
}

/** What worker-media runs the media queue with. */
export interface MediaProcessor
  extends ImageProcessor, VideoProcessor, PdfProcessor, StampProcessor {}

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
  | "image_too_large"
  /** The media process ran past its deadline. */
  | "media_timeout"
  /** A video longer than its limit, as ffprobe measures it (#86). */
  | "video_too_long"
  /** A video file with no picture in it, only sound or data (#86). */
  | "no_video_stream"
  /** An essay PDF exceeds the safe raster/page or output limits (#96). */
  | "pdf_too_large";

export const MEDIA_ERROR_CODES = [
  "unsupported_type",
  "media_decode_failed",
  "image_too_large",
  "media_timeout",
  "video_too_long",
  "no_video_stream",
  "pdf_too_large",
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
  unsupported_type: "The file is not a type the platform processes",
  media_decode_failed: "The file could not be decoded",
  image_too_large: "The image has more pixels than the platform processes",
  media_timeout: "The file took too long to process",
  video_too_long: "The video is longer than the limit",
  no_video_stream: "The file has no video picture in it",
  pdf_too_large: "The PDF has too many pages or is too large to prepare",
};

/** The most pixels an adapter decodes by default: 100 megapixels. */
export const DEFAULT_MAX_INPUT_PIXELS = 100_000_000;

/**
 * Why a file's media job failed for good: a MediaErrorCode, or
 * processing_error when it kept failing without one (storage or the
 * worker itself) until its last try.
 */
export const FILE_PROCESSING_ERROR_CODES = [
  ...MEDIA_ERROR_CODES,
  "processing_error",
] as const;

export type FileProcessingErrorCode =
  (typeof FILE_PROCESSING_ERROR_CODES)[number];

/** Thrown while a deployment has no media processor: the app on Vercel. */
export class MediaNotConfiguredError extends Error {
  constructor() {
    super(
      "No media processor here: images, videos and essay PDFs are processed in " +
        "worker-media, which drains the media queue."
    );
    this.name = "MediaNotConfiguredError";
  }
}

/**
 * The app's processor. The web app and the default worker never run the
 * media queue, so this is never called; if it were, it would refuse.
 */
export const unconfiguredMedia: MediaProcessor = {
  processImage: () => Promise.reject(new MediaNotConfiguredError()),
  processVideo: () => Promise.reject(new MediaNotConfiguredError()),
  processPdf: () => Promise.reject(new MediaNotConfiguredError()),
  stampImage: () => Promise.reject(new MediaNotConfiguredError()),
};
