// Shared contract for every MediaProcessor adapter. The sharp adapter and
// the in-memory fake both run it on the committed fixtures, so the fake
// stays faithful: a fake that passes a check the sharp adapter fails is
// wrong. Only imported by *.test.ts.

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  planImageDerivatives,
  type DerivativeKind,
} from "@/server/modules/files/domain/derivatives";
import { readMediaFixture } from "@/test/media-fixtures";
import { webpMetadata, webpSize } from "@/test/webp";

import { planVideoTranscode } from "@/server/modules/files/domain/video-transcode";

import {
  MediaError,
  type ImageProcessor,
  type MediaErrorCode,
  type VideoProcessor,
} from "./media";

export type MediaContractSetup = () => Promise<{ processor: ImageProcessor }>;

export type VideoContractSetup = () => Promise<{ processor: VideoProcessor }>;

/** `bytes` as the stream storage hands the media job. */
export function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([new Uint8Array(bytes)]).stream();
}

const BOTH: DerivativeKind[] = ["thumb_320", "display_1600"];

/** A 1 x 1 GIF89a. */
const GIF = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

const text = (value: string) => new TextEncoder().encode(value);

/** A 300 x 200 image in `format`, made by sharp. */
function made(format: "png" | "webp" | "avif"): Promise<Uint8Array> {
  return sharp({
    create: { width: 300, height: 200, channels: 3, background: "#3a7" },
  })
    .toFormat(format)
    .toBuffer()
    .then((buffer) => new Uint8Array(buffer));
}

export async function expectMediaError(
  promise: Promise<unknown>,
  code: MediaErrorCode
) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(MediaError);
  expect(error).toMatchObject({ code });
}

export function mediaProcessorContract(
  name: string,
  setup: MediaContractSetup
) {
  describe(`${name} (MediaProcessor contract)`, () => {
    it("makes WebP copies of a JPEG at exactly the planned sizes", async () => {
      const { processor } = await setup();
      const result = await processor.processImage({
        bytes: readMediaFixture("gpsJpeg"),
        kinds: BOTH,
      });

      expect(result.sniffedType).toBe("image/jpeg");
      expect(result.source).toMatchObject({ width: 2000, height: 1500 });
      const sizes = result.derivatives.map(
        ({ kind, width, height, contentType }) => ({
          kind,
          width,
          height,
          contentType,
        })
      );
      expect(sizes).toEqual([
        {
          kind: "thumb_320",
          width: 320,
          height: 240,
          contentType: "image/webp",
        },
        {
          kind: "display_1600",
          width: 1600,
          height: 1200,
          contentType: "image/webp",
        },
      ]);
      expect(sizes).toEqual(planImageDerivatives(result.source, BOTH));
      for (const derivative of result.derivatives) {
        expect(webpSize(derivative.bytes)).toEqual({
          width: derivative.width,
          height: derivative.height,
        });
      }
    });

    it.each(["gpsJpeg", "iphoneHeic"] as const)(
      "keeps no location, camera, XMP or IPTC data from %s",
      async (fixture) => {
        const { processor } = await setup();
        const { derivatives } = await processor.processImage({
          bytes: readMediaFixture(fixture),
          kinds: BOTH,
        });

        expect(derivatives).toHaveLength(2);
        for (const derivative of derivatives) {
          expect(webpMetadata(derivative.bytes)).toEqual([]);
        }
      }
    );

    it("bakes the EXIF orientation into upright copies", async () => {
      const { processor } = await setup();
      const result = await processor.processImage({
        bytes: readMediaFixture("rotatedJpeg"),
        kinds: BOTH,
      });

      expect(result.source).toEqual({
        width: 600,
        height: 400,
        orientation: 6,
      });
      expect(
        result.derivatives.map(({ kind, width, height }) => ({
          kind,
          width,
          height,
        }))
      ).toEqual([
        { kind: "thumb_320", width: 213, height: 320 },
        { kind: "display_1600", width: 400, height: 600 },
      ]);
      for (const derivative of result.derivatives) {
        expect(webpSize(derivative.bytes)).toEqual({
          width: derivative.width,
          height: derivative.height,
        });
        // No EXIF chunk, so no Orientation tag to turn it a second time.
        expect(webpMetadata(derivative.bytes)).toEqual([]);
      }
    });

    it("decodes a HEIC grid photo, turned by its container", async () => {
      const { processor } = await setup();
      const result = await processor.processImage({
        bytes: readMediaFixture("iphoneHeic"),
        kinds: BOTH,
      });

      expect(result.sniffedType).toBe("image/heic");
      // Upright already: its EXIF Orientation 6 must not turn it again.
      expect(result.source).toEqual({ width: 700, height: 1100 });
      expect(
        result.derivatives.map(({ kind, width, height }) => ({
          kind,
          width,
          height,
        }))
      ).toEqual([
        { kind: "thumb_320", width: 204, height: 320 },
        { kind: "display_1600", width: 700, height: 1100 },
      ]);
      for (const derivative of result.derivatives) {
        expect(webpSize(derivative.bytes)).toEqual({
          width: derivative.width,
          height: derivative.height,
        });
      }
    });

    it.each(["png", "webp"] as const)(
      "takes a %s by its bytes",
      async (format) => {
        const { processor } = await setup();
        const result = await processor.processImage({
          bytes: await made(format),
          kinds: ["thumb_320"],
        });

        expect(result.sniffedType).toBe(`image/${format}`);
        expect(result.source).toMatchObject({ width: 300, height: 200 });
        expect(result.derivatives).toMatchObject([
          { kind: "thumb_320", width: 300, height: 200 },
        ]);
      }
    );

    it("makes only the kinds asked for, each once, in that order", async () => {
      const { processor } = await setup();
      const { derivatives } = await processor.processImage({
        bytes: readMediaFixture("gpsJpeg"),
        kinds: ["display_1600", "thumb_320", "display_1600"],
      });

      expect(derivatives.map((derivative) => derivative.kind)).toEqual([
        "display_1600",
        "thumb_320",
      ]);
    });

    it("makes nothing when asked for no kinds", async () => {
      const { processor } = await setup();
      const result = await processor.processImage({
        bytes: readMediaFixture("gpsJpeg"),
        kinds: [],
      });

      expect(result.derivatives).toEqual([]);
    });

    it.each([
      ["a GIF", async () => GIF],
      ["an AVIF", () => made("avif")],
      ["a PDF", async () => text("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")],
      ["an HTML page", async () => text("<!doctype html><title>x</title>")],
      ["no bytes", async () => new Uint8Array()],
    ])("refuses %s as unsupported_type", async (_, bytes) => {
      const { processor } = await setup();
      await expectMediaError(
        processor.processImage({ bytes: await bytes(), kinds: BOTH }),
        "unsupported_type"
      );
    });

    it("refuses a JPEG whose pixels don't decode as media_decode_failed", async () => {
      const { processor } = await setup();
      await expectMediaError(
        processor.processImage({
          bytes: readMediaFixture("corruptJpeg"),
          kinds: BOTH,
        }),
        "media_decode_failed"
      );
    });

    it("refuses JPEG markers followed by nothing as media_decode_failed", async () => {
      const { processor } = await setup();
      await expectMediaError(
        processor.processImage({
          bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
          kinds: BOTH,
        }),
        "media_decode_failed"
      );
    });
  });
}

const THREE_MINUTES = 3 * 60 * 1000;

/**
 * The video half (#86). The ffmpeg adapter runs it where ffmpeg is
 * (./media-ffmpeg.media.test.ts); the fake runs it in `pnpm test`.
 */
export function videoProcessorContract(
  name: string,
  setup: VideoContractSetup
) {
  describe(`${name} (VideoProcessor contract)`, () => {
    it.each([
      ["a QuickTime clip", "gpsMov", "video/quicktime"],
      ["a WebM clip", "clipWebm", "video/webm"],
    ] as const)(
      "makes an MP4 copy and a JPEG poster of %s at the planned sizes",
      async (_, fixture, sniffedType) => {
        const { processor } = await setup();
        const result = await processor.processVideo({
          source: streamOf(readMediaFixture(fixture)),
          maxDurationMs: THREE_MINUTES,
        });

        expect(result.sniffedType).toBe(sniffedType);
        const planned = planVideoTranscode(result.probe, {
          maxDurationMs: THREE_MINUTES,
        });
        if (!planned.ok) throw new Error("the clip should be in its limit");
        const { plan } = planned;
        expect(
          result.derivatives.map(({ bytes: _bytes, ...rest }) => rest)
        ).toEqual([
          {
            kind: "video_mp4",
            contentType: "video/mp4",
            width: plan.width,
            height: plan.height,
            durationMs: result.probe.durationMs,
          },
          {
            kind: "video_poster",
            contentType: "image/jpeg",
            width: plan.posterWidth,
            height: plan.posterHeight,
            durationMs: null,
          },
        ]);
        expect(plan.width % 2).toBe(0);
        expect(plan.height % 2).toBe(0);
        expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(1920);
        expect(Math.min(plan.width, plan.height)).toBeLessThanOrEqual(1080);
        const [copy, poster] = result.derivatives;
        // An MP4 container, and a JPEG.
        expect(text("ftyp")).toEqual(copy!.bytes.subarray(4, 8));
        expect([...poster!.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      }
    );

    it("refuses a clip longer than the limit as video_too_long", async () => {
      const { processor } = await setup();
      await expectMediaError(
        processor.processVideo({
          source: streamOf(readMediaFixture("gpsMov")),
          // The tolerance is a second; the clip is a second long.
          maxDurationMs: -1_000,
        }),
        "video_too_long"
      );
    });

    it.each([
      ["a JPEG", async () => readMediaFixture("gpsJpeg")],
      ["a HEIC photo", async () => readMediaFixture("iphoneHeic")],
      ["a PDF", async () => text("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")],
      ["no bytes", async () => new Uint8Array()],
    ])("refuses %s as unsupported_type", async (_, bytes) => {
      const { processor } = await setup();
      await expectMediaError(
        processor.processVideo({
          source: streamOf(await bytes()),
          maxDurationMs: THREE_MINUTES,
        }),
        "unsupported_type"
      );
    });
  });
}
