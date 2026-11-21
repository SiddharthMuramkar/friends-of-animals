// The sharp media processor (the MediaProcessor port in ./media.ts). It runs
// in worker-media and in Vitest, with no Docker and no system libraries:
//   - JPEG, PNG and WebP decode in prebuilt sharp (libvips). Its EXIF
//     orientation is applied on load (`autoOrient`).
//   - HEIC and HEIF decode in libheif compiled to WASM (heic-decode), which
//     applies the container's rotation and mirroring, then prebuilt sharp
//     encodes the pixels. Prebuilt sharp has no HEVC decoder (it's
//     patent-encumbered), and building one would mean a global libvips in
//     the image that `pnpm test` can't exercise. libheif's WASM build is
//     LGPL-3.0 and decodes HEVC in software: HR-36 records both.
// The decoder is chosen by the bytes (sniffImageType), never by the type
// the upload declared.
//
// Every derivative is encoded from decoded pixels with sharp's default of
// keeping no metadata, so no EXIF (location, camera, orientation), XMP,
// IPTC or ICC profile survives. Never call keepMetadata(), keepExif(),
// withMetadata() or anything like them here.
//
// Loads under plain Node (the worker): relative imports only.

import decodeHeif from "heic-decode";
import sharp, { type Sharp, type SharpOptions } from "sharp";

import {
  DERIVATIVE_KINDS,
  planImageDerivatives,
  type PixelSize,
  type PlannedDerivative,
} from "../modules/files/domain/derivatives";
import { sniffImageType } from "../modules/files/domain/image-type";
import {
  DEFAULT_MAX_INPUT_PIXELS,
  MediaError,
  type MediaProcessor,
  type MediaResult,
} from "./media";

export type SharpMediaOptions = {
  /** Refuse images with more pixels than this (image_too_large). */
  maxInputPixels?: number;
  /** Stop encoding one derivative after this many seconds. */
  timeoutSeconds?: number;
};

/** Long enough for a 100-megapixel JPEG on one slow core. */
const DEFAULT_TIMEOUT_SECONDS = 60;

/** A sharp pipeline that reads the decoded original, fresh each time. */
type Decoded = { source: MediaResult["source"]; load: () => Sharp };

function tooLarge(size: PixelSize, maxInputPixels: number): boolean {
  return size.width * size.height > maxInputPixels;
}

async function decodeRaster(
  bytes: Uint8Array,
  maxInputPixels: number
): Promise<Decoded> {
  const options: SharpOptions = {
    // sharp checks this again on decode; the check below types the error.
    limitInputPixels: maxInputPixels,
    autoOrient: true,
    // Animated WebP and PNG: the first frame only.
    pages: 1,
  };
  // Header only, without the limit: sharp would refuse an image over it
  // with an untyped error before saying how large it is.
  const metadata = await sharp(bytes, { ...options, limitInputPixels: false })
    .metadata()
    .catch((error: unknown) => {
      throw new MediaError("media_decode_failed", { cause: error });
    });
  if (tooLarge(metadata, maxInputPixels)) {
    throw new MediaError("image_too_large");
  }
  return {
    source: {
      width: metadata.width,
      height: metadata.height,
      ...(metadata.orientation ? { orientation: metadata.orientation } : {}),
    },
    load: () => sharp(bytes, options),
  };
}

async function decodeHeic(
  bytes: Uint8Array,
  maxInputPixels: number
): Promise<Decoded> {
  const images = await decodeHeif.all({ buffer: bytes }).catch((error) => {
    throw new MediaError("media_decode_failed", { cause: error });
  });
  try {
    const [primary] = images;
    if (!primary) throw new MediaError("media_decode_failed");
    if (tooLarge(primary, maxInputPixels)) {
      throw new MediaError("image_too_large");
    }
    const { width, height, data } = await primary.decode().catch((error) => {
      throw new MediaError("media_decode_failed", { cause: error });
    });
    const pixels = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return {
      // libheif has applied the container's rotation already.
      source: { width, height },
      load: () =>
        sharp(pixels, { raw: { width, height, channels: 4 } }).removeAlpha(),
    };
  } finally {
    images.dispose();
  }
}

async function encode(
  decoded: Decoded,
  planned: PlannedDerivative,
  timeoutSeconds: number
): Promise<Uint8Array> {
  const buffer = await decoded
    .load()
    .timeout({ seconds: timeoutSeconds })
    // The plan keeps the aspect ratio, so "fill" only fixes rounding.
    .resize(planned.width, planned.height, { fit: "fill" })
    .webp({ quality: DERIVATIVE_KINDS[planned.kind].quality })
    .toBuffer()
    .catch((error: unknown) => {
      throw new MediaError("media_decode_failed", { cause: error });
    });
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export function sharpMediaProcessor(
  options: SharpMediaOptions = {}
): MediaProcessor {
  const maxInputPixels = options.maxInputPixels ?? DEFAULT_MAX_INPUT_PIXELS;
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  return {
    async processImage({ bytes, kinds }) {
      const sniffedType = sniffImageType(bytes);
      if (!sniffedType) throw new MediaError("unsupported_type");
      const decoded =
        sniffedType === "image/heic" || sniffedType === "image/heif"
          ? await decodeHeic(bytes, maxInputPixels)
          : await decodeRaster(bytes, maxInputPixels);
      const derivatives: MediaResult["derivatives"] = [];
      for (const planned of planImageDerivatives(decoded.source, kinds)) {
        derivatives.push({
          ...planned,
          bytes: await encode(decoded, planned, timeoutSeconds),
        });
      }
      return { sniffedType, source: decoded.source, derivatives };
    },
  };
}
