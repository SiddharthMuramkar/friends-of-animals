// The ffmpeg adapter against real ffmpeg and ffprobe (#86): `pnpm
// test:media`, in the worker-media image, which installs them
// (vitest.media.config.ts). The shared contract, then what only real
// ffmpeg can show: the copy is H.264 and AAC, upright, and keeps nothing
// of the original's metadata, and the poster decodes.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

import { readMediaFixture, type MediaFixture } from "@/test/media-fixtures";

import { streamOf, videoProcessorContract } from "./media.contract";
import { ffmpegVideoProcessor, spawnProcess } from "./media-ffmpeg";

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";
const TMP = process.env.FOA_MEDIA_TMPDIR ?? tmpdir();

const processor = ffmpegVideoProcessor({
  ffmpeg: FFMPEG,
  ffprobe: FFPROBE,
  tmpRoot: TMP,
});

videoProcessorContract("ffmpegVideoProcessor", async () => ({ processor }));

const scratch = await mkdtemp(join(TMP, "foa-media-test-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));

type Probed = {
  streams: {
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    tags?: Record<string, string>;
    side_data_list?: unknown[];
  }[];
  format: { tags?: Record<string, string> };
};

/** What ffprobe says about `bytes`. */
async function probe(bytes: Uint8Array, name: string): Promise<Probed> {
  const path = join(scratch, name);
  await writeFile(path, bytes);
  const result = await spawnProcess(
    FFPROBE,
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", path],
    { timeoutMs: 30_000 }
  );
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as Probed;
}

const fixture = (name: MediaFixture) => readMediaFixture(name);

/** Every tag value, anywhere in ffprobe's answer, lower-cased. */
function tagsOf(probed: Probed): Record<string, string> {
  return Object.fromEntries(
    [probed.format.tags ?? {}, ...probed.streams.map((s) => s.tags ?? {})]
      .flatMap((tags) => Object.entries(tags))
      .map(([key, value]) => [key.toLowerCase(), value])
  );
}

const LEAKS = ["location", "iso6709", "make", "model", "creation_time"];

describe("ffmpegVideoProcessor with real ffmpeg", () => {
  it("plants the metadata the strip checks look for", async () => {
    // Without this, a fixture that lost its metadata would make the strip
    // checks below pass for nothing.
    const tags = Object.keys(tagsOf(await probe(fixture("gpsMov"), "in.mov")));
    for (const leak of LEAKS) {
      expect(tags.some((key) => key.includes(leak))).toBe(true);
    }
  });

  it("makes an upright H.264 and AAC copy that keeps none of the metadata", async () => {
    const result = await processor.processVideo({
      source: streamOf(fixture("gpsMov")),
      maxDurationMs: 180_000,
    });
    const copy = await probe(result.derivatives[0]!.bytes, "copy.mp4");

    const video = copy.streams.find((s) => s.codec_type === "video")!;
    const audio = copy.streams.find((s) => s.codec_type === "audio")!;
    expect(video).toMatchObject({
      codec_name: "h264",
      width: 240,
      height: 320,
    });
    expect(audio.codec_name).toBe("aac");
    // The rotation is in the pixels now, not in a display matrix.
    expect(video.side_data_list ?? []).toEqual([]);
    expect(copy.streams).toHaveLength(2);
    const tags = Object.keys(tagsOf(copy));
    for (const leak of LEAKS) {
      expect(tags.filter((key) => key.includes(leak))).toEqual([]);
    }
    // Only what the MP4 muxer itself writes is left: brands, track
    // handlers and languages, and the encoder's name without a version
    // (bitexact).
    expect(Object.keys(copy.format.tags ?? {}).toSorted()).toEqual([
      "compatible_brands",
      "major_brand",
      "minor_version",
    ]);
    const streamTags = new Set(
      copy.streams.flatMap((stream) => Object.keys(stream.tags ?? {}))
    );
    expect(
      [...streamTags].filter(
        (key) =>
          !["language", "handler_name", "vendor_id", "encoder"].includes(key)
      )
    ).toEqual([]);
    expect(video.tags?.encoder ?? "").not.toMatch(/Lav[cf]\d|\d+\.\d+/);
  });

  it("makes a poster that decodes, at its planned size, with no EXIF", async () => {
    const result = await processor.processVideo({
      source: streamOf(fixture("gpsMov")),
      maxDurationMs: 180_000,
    });
    const poster = result.derivatives[1]!;
    const metadata = await sharp(poster.bytes).metadata();
    expect(metadata).toMatchObject({
      format: "jpeg",
      width: poster.width,
      height: poster.height,
    });
    expect(metadata.exif).toBeUndefined();
  });

  it("transcodes a WebM clip to H.264 and AAC in MP4", async () => {
    const result = await processor.processVideo({
      source: streamOf(fixture("clipWebm")),
      maxDurationMs: 180_000,
    });
    const copy = await probe(result.derivatives[0]!.bytes, "webm-copy.mp4");
    expect(copy.streams.map((s) => s.codec_name)).toEqual(["h264", "aac"]);
    expect(Object.keys(tagsOf(copy))).not.toContain("title");
  });
});
