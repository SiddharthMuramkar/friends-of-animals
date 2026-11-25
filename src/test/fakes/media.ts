// In-memory MediaProcessor for Seam 1 tests. It passes the same contract
// as the sharp and ffmpeg adapters (src/server/ports/media.contract.ts)
// without decoding a pixel. For an image it sniffs the type, reads the size
// and EXIF orientation from the image's headers, checks the file isn't cut
// short, and returns minimal WebP containers of the planned sizes, which
// hold no metadata. For a video (#86) it sniffs the type, takes the probe a
// test set with nextVideo() (a 40 s 1080p clip by default) and runs the
// same pure planner as the ffmpeg adapter, so the length rule and the sizes
// can't drift; it returns a bare MP4 header and a bare JPEG of the planned
// sizes.
//
//   const media = new FakeMediaProcessor();
//   media.failNext(1, "media_decode_failed"); // the next call rejects
//   media.nextVideo({ durationMs: 181_001 }); // what the next video probes as
//   media.processed;                          // every image input, oldest first
//   media.videos;                             // every video call, oldest first
//   media.pdfs;                               // every PDF input, oldest first

import {
  planImageDerivatives,
  type PixelSize,
} from "@/server/modules/files/domain/derivatives";
import {
  sniffImageType,
  type SniffedImageType,
} from "@/server/modules/files/domain/image-type";
import type { VideoProbe } from "@/server/modules/files/domain/video-probe";
import {
  sniffVideoType,
  VIDEO_SNIFF_BYTES,
} from "@/server/modules/files/domain/video-sniff";
import { planVideoTranscode } from "@/server/modules/files/domain/video-transcode";
import {
  MediaError,
  type MediaErrorCode,
  type MediaInput,
  type MediaProcessor,
  type MediaResult,
  type PdfDerivative,
  type VideoInput,
  type VideoResult,
} from "@/server/ports/media";
import { sniffContentType } from "@/server/modules/files/domain/sniff";
import { minimalWebp } from "@/test/webp";

type Source = MediaResult["source"];

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const viewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// --- JPEG ------------------------------------------------------------------

/** SOF markers that carry the frame size (not DHT C4, JPG C8 or DAC CC). */
const SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** The Orientation tag of an APP1 Exif segment's IFD0, if it has one. */
function exifOrientation(segment: Uint8Array): number | undefined {
  if (ascii(segment, 0, 6) !== "Exif\0\0") return undefined;
  const tiff = segment.subarray(6);
  const view = viewOf(tiff);
  const little = ascii(tiff, 0, 2) === "II";
  const ifd = view.getUint32(4, little);
  const entries = view.getUint16(ifd, little);
  for (let entry = 0; entry < entries; entry += 1) {
    const at = ifd + 2 + entry * 12;
    if (view.getUint16(at, little) === 0x0112) {
      return view.getUint16(at + 8, little);
    }
  }
  return undefined;
}

function jpegSource(bytes: Uint8Array): Source | null {
  const view = viewOf(bytes);
  if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;
  let size: PixelSize | null = null;
  let orientation: number | undefined;
  for (let at = 2; at + 4 <= bytes.length;) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xda) break; // start of scan: the headers are over
    const length = view.getUint16(at + 2);
    const segment = bytes.subarray(at + 4, at + 2 + length);
    if (SOF.has(marker) && segment.length >= 5) {
      const frame = viewOf(segment);
      size = { width: frame.getUint16(3), height: frame.getUint16(1) };
    }
    if (marker === 0xe1) orientation ??= exifOrientation(segment);
    at += 2 + length;
  }
  if (!size || size.width === 0 || size.height === 0) return null;
  return orientation ? { ...size, orientation } : size;
}

// --- PNG and WebP ----------------------------------------------------------

function pngSource(bytes: Uint8Array): Source | null {
  if (bytes.length < 45 || ascii(bytes, bytes.length - 8, 4) !== "IEND") {
    return null;
  }
  const view = viewOf(bytes);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function webpSource(bytes: Uint8Array): Source | null {
  const view = viewOf(bytes);
  if (bytes.length < 30 || view.getUint32(4, true) + 8 !== bytes.length) {
    return null;
  }
  const chunk = ascii(bytes, 12, 4);
  const u24 = (at: number) =>
    bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
  if (chunk === "VP8X") return { width: u24(24) + 1, height: u24(27) + 1 };
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  return null;
}

// --- HEIF --------------------------------------------------------------------

type Box = { type: string; body: number; end: number };

function boxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const view = viewOf(bytes);
  const found: Box[] = [];
  for (let at = start; at + 8 <= end;) {
    const size = view.getUint32(at);
    if (size < 8 || at + size > end) return found;
    found.push({ type: ascii(bytes, at + 4, 4), body: at + 8, end: at + size });
    at += size;
  }
  return found;
}

const find = (list: Box[], type: string) =>
  list.find((box) => box.type === type);

/**
 * The primary item's size from its `ispe` property, turned by its `irot`
 * property: what libheif decodes. HEIF keeps rotation in the container,
 * so the size it reports needs no orientation.
 */
function heifSource(bytes: Uint8Array): Source | null {
  const view = viewOf(bytes);
  const meta = find(boxes(bytes, 0, bytes.length), "meta");
  if (!meta) return null;
  const children = boxes(bytes, meta.body + 4, meta.end);
  const pitm = find(children, "pitm");
  const iprp = find(children, "iprp");
  if (!pitm || !iprp) return null;
  const primary =
    bytes[pitm.body] === 0
      ? view.getUint16(pitm.body + 4)
      : view.getUint32(pitm.body + 4);
  const properties = boxes(bytes, iprp.body, iprp.end);
  const ipco = find(properties, "ipco");
  const ipma = find(properties, "ipma");
  if (!ipco || !ipma) return null;
  const list = boxes(bytes, ipco.body, ipco.end);

  const version = bytes[ipma.body]!;
  const wideIndex = (bytes[ipma.body + 3]! & 1) === 1;
  let at = ipma.body + 8;
  const entries = view.getUint32(ipma.body + 4);
  for (let entry = 0; entry < entries; entry += 1) {
    const item = version < 1 ? view.getUint16(at) : view.getUint32(at);
    at += version < 1 ? 2 : 4;
    const count = bytes[at]!;
    at += 1;
    const indexes: number[] = [];
    for (let n = 0; n < count; n += 1) {
      indexes.push(wideIndex ? view.getUint16(at) & 0x7fff : bytes[at]! & 0x7f);
      at += wideIndex ? 2 : 1;
    }
    if (item !== primary) continue;
    const associated = indexes.map((index) => list[index - 1]);
    const ispe = associated.find((box) => box?.type === "ispe");
    const irot = associated.find((box) => box?.type === "irot");
    if (!ispe) return null;
    const width = view.getUint32(ispe.body + 4);
    const height = view.getUint32(ispe.body + 8);
    const quarterTurn = irot ? (bytes[irot.body]! & 3) % 2 === 1 : false;
    return quarterTurn ? { width: height, height: width } : { width, height };
  }
  return null;
}

// --- The fake ----------------------------------------------------------------

const READERS: Record<SniffedImageType, (bytes: Uint8Array) => Source | null> =
  {
    "image/jpeg": jpegSource,
    "image/png": pngSource,
    "image/webp": webpSource,
    "image/heic": heifSource,
    "image/heif": heifSource,
  };

/** Its header, or null when the bytes are cut short or don't add up. */
function readSource(type: SniffedImageType, bytes: Uint8Array): Source | null {
  try {
    return READERS[type](bytes);
  } catch {
    return null; // read past the end: the file is cut short
  }
}

/** What a video probes as unless a test says otherwise: 40 s of 1080p. */
export const DEFAULT_VIDEO_PROBE: VideoProbe = {
  durationMs: 40_000,
  width: 1920,
  height: 1080,
  rotation: 0,
  videoCodec: "h264",
  audioCodec: "aac",
  formatName: "mov,mp4,m4a,3gp,3g2,mj2",
};

/** An MP4's `ftyp` box alone: sniffs as video/mp4, holds no metadata. */
function bareMp4(): Uint8Array {
  return Uint8Array.from([
    0x00, 0x00, 0x00, 0x10, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x02, 0x00,
  ]);
}

/** A JPEG of just its start, frame size and end: no EXIF, no pixels. */
export function bareJpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
}

export class FakeMediaProcessor implements MediaProcessor {
  /** Every image input, oldest first, failed ones included. */
  readonly processed: MediaInput[] = [];
  /** Every video call, oldest first, failed ones included. */
  readonly videos: { sizeBytes: number; maxDurationMs: number }[] = [];
  /** Every PDF call, oldest first, failed ones included. */
  readonly pdfs: Uint8Array[] = [];
  private failures: MediaErrorCode[] = [];
  private probes: (Partial<VideoProbe> | "no_video_stream")[] = [];

  /** The next `times` calls, image, video or PDF, reject with `code`. */
  failNext(times: number, code: MediaErrorCode = "media_decode_failed") {
    this.failures.push(...Array.from({ length: times }, () => code));
  }

  /** What the next video probes as: these fields over the default. */
  nextVideo(probe: Partial<VideoProbe> | "no_video_stream") {
    this.probes.push(probe);
  }

  async processVideo({
    source,
    maxDurationMs,
  }: VideoInput): Promise<VideoResult> {
    const bytes = new Uint8Array(await new Response(source).arrayBuffer());
    this.videos.push({ sizeBytes: bytes.length, maxDurationMs });
    const failure = this.failures.shift();
    if (failure) throw new MediaError(failure);
    const sniffedType = sniffVideoType(bytes.subarray(0, VIDEO_SNIFF_BYTES));
    if (!sniffedType) throw new MediaError("unsupported_type");
    const next = this.probes.shift() ?? {};
    if (next === "no_video_stream") throw new MediaError("no_video_stream");
    const probe = { ...DEFAULT_VIDEO_PROBE, ...next };
    const decision = planVideoTranscode(probe, { maxDurationMs });
    if (!decision.ok) throw new MediaError("video_too_long");
    const { plan } = decision;
    return {
      sniffedType,
      probe,
      derivatives: [
        {
          kind: "video_mp4",
          contentType: "video/mp4",
          width: plan.width,
          height: plan.height,
          durationMs:
            probe.durationMs === null
              ? null
              : Math.min(probe.durationMs, plan.maxOutputS * 1000),
          bytes: bareMp4(),
        },
        {
          kind: "video_poster",
          contentType: "image/jpeg",
          width: plan.posterWidth,
          height: plan.posterHeight,
          durationMs: null,
          bytes: bareJpeg(plan.posterWidth, plan.posterHeight),
        },
      ],
    };
  }

  async processPdf({ bytes }: { bytes: Uint8Array }): Promise<PdfDerivative> {
    this.pdfs.push(bytes);
    const failure = this.failures.shift();
    if (failure) throw new MediaError(failure);
    if (sniffContentType(bytes) !== "application/pdf") {
      throw new MediaError("unsupported_type");
    }
    if (!new TextDecoder().decode(bytes).trimEnd().endsWith("%%EOF")) {
      throw new MediaError("media_decode_failed");
    }
    return {
      kind: "pdf_clean",
      contentType: "application/pdf",
      width: null,
      height: null,
      durationMs: null,
      bytes: new TextEncoder().encode(
        "%PDF-1.4\n% Raster-only fake copy\n%%EOF\n"
      ),
    };
  }

  async processImage(input: MediaInput): Promise<MediaResult> {
    this.processed.push(input);
    const failure = this.failures.shift();
    if (failure) throw new MediaError(failure);
    const sniffedType = sniffImageType(input.bytes);
    if (!sniffedType) throw new MediaError("unsupported_type");
    const source = readSource(sniffedType, input.bytes);
    if (!source) throw new MediaError("media_decode_failed");
    return {
      sniffedType,
      source,
      derivatives: planImageDerivatives(source, input.kinds).map((planned) => ({
        ...planned,
        bytes: minimalWebp(planned.width, planned.height),
      })),
    };
  }
}
