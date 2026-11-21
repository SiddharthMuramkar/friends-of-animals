import { describe, expect, it } from "vitest";

import type { VideoProbe } from "./video-probe";
import {
  TRANSCODE_PROFILE,
  planVideoTranscode,
  posterArgs,
  transcodeArgs,
  type VideoTranscodePlan,
} from "./video-transcode";

const probe = (overrides: Partial<VideoProbe> = {}): VideoProbe => ({
  durationMs: 40_000,
  width: 3840,
  height: 2160,
  rotation: 0,
  videoCodec: "hevc",
  audioCodec: "aac",
  formatName: "mov,mp4,m4a,3gp,3g2,mj2",
  ...overrides,
});

const limits = { maxDurationMs: 180_000 };

function plan(overrides: Partial<VideoProbe> = {}): VideoTranscodePlan {
  const result = planVideoTranscode(probe(overrides), limits);
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
  return result.plan;
}

describe("planVideoTranscode", () => {
  it("fits a 4K landscape clip into 1920 x 1080", () => {
    expect(plan()).toMatchObject({
      width: 1920,
      height: 1080,
      posterWidth: 1280,
      posterHeight: 720,
    });
  });

  it("fits a portrait clip into 1080 x 1920", () => {
    expect(plan({ width: 2160, height: 3840 })).toMatchObject({
      width: 1080,
      height: 1920,
      posterWidth: 720,
      posterHeight: 1280,
    });
  });

  it("never enlarges, and keeps both sides even for H.264", () => {
    expect(plan({ width: 641, height: 359 })).toMatchObject({
      width: 640,
      height: 358,
      posterWidth: 641,
      posterHeight: 359,
    });
  });

  it("fits a wide clip by its width and a square one by its short side", () => {
    expect(plan({ width: 2560, height: 1080 })).toMatchObject({
      width: 1920,
      height: 810,
    });
    expect(plan({ width: 2000, height: 2000 })).toMatchObject({
      width: 1080,
      height: 1080,
    });
  });

  it("refuses a clip over the length limit before any work is done", () => {
    expect(planVideoTranscode(probe({ durationMs: 181_001 }), limits)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("takes the poster at one second, or halfway through a shorter clip", () => {
    expect(plan().posterAtS).toBe(1);
    expect(plan({ durationMs: 1_200 }).posterAtS).toBe(0.6);
    expect(plan({ durationMs: null }).posterAtS).toBe(0);
  });

  it("caps the output at the limit, in case the container lies", () => {
    expect(plan().maxOutputS).toBe(181);
    expect(plan({ durationMs: null })).toMatchObject({
      maxOutputS: 181,
      durationKnown: false,
    });
  });

  it("allows four times the clip's length to transcode, plus a minute", () => {
    expect(plan({ durationMs: 10_000 }).timeoutMs).toBe(180_000);
    expect(plan({ durationMs: 60_000 }).timeoutMs).toBe(300_000);
    expect(plan({ durationMs: null }).timeoutMs).toBe(780_000);
  });

  it("knows whether there is sound to encode", () => {
    expect(plan().hasAudio).toBe(true);
    expect(plan({ audioCodec: null }).hasAudio).toBe(false);
  });
});

function valueAfter(args: readonly string[], flag: string): string[] {
  return args.flatMap((arg, index) =>
    arg === flag ? [args[index + 1] ?? ""] : []
  );
}

describe("transcodeArgs", () => {
  const args = transcodeArgs("/tmp/in-1.mov", "/tmp/out-1.mp4", plan());

  it("reads the input and writes an MP4 to the output, last", () => {
    expect(valueAfter(args, "-i")).toEqual(["/tmp/in-1.mov"]);
    expect(args.at(-1)).toBe("/tmp/out-1.mp4");
    expect(valueAfter(args, "-f")).toEqual(["mp4"]);
  });

  it("keeps only the first video and the first audio stream", () => {
    expect(valueAfter(args, "-map")).toEqual(["0:v:0", "0:a:0?"]);
    expect(args).toContain("-sn");
    expect(args).toContain("-dn");
  });

  it("drops every piece of metadata, location and camera included", () => {
    expect(valueAfter(args, "-map_metadata")).toEqual(["-1"]);
    expect(valueAfter(args, "-map_chapters")).toEqual(["-1"]);
    expect(valueAfter(args, "-fflags")).toEqual(["+bitexact"]);
    expect(valueAfter(args, "-flags:v")).toEqual(["+bitexact"]);
    expect(valueAfter(args, "-flags:a")).toEqual(["+bitexact"]);
  });

  it("encodes H.264 and AAC that plays in every browser, from the start", () => {
    expect(valueAfter(args, "-c:v")).toEqual(["libx264"]);
    expect(valueAfter(args, "-pix_fmt")).toEqual(["yuv420p"]);
    expect(valueAfter(args, "-profile:v")).toEqual(["high"]);
    expect(valueAfter(args, "-preset")).toEqual([TRANSCODE_PROFILE.preset]);
    expect(valueAfter(args, "-crf")).toEqual([String(TRANSCODE_PROFILE.crf)]);
    expect(valueAfter(args, "-c:a")).toEqual(["aac"]);
    expect(valueAfter(args, "-movflags")).toEqual(["+faststart"]);
  });

  it("scales to the planned size and stops at the length cap", () => {
    expect(valueAfter(args, "-vf")).toEqual(["scale=1920:1080"]);
    expect(valueAfter(args, "-t")).toEqual(["181"]);
  });

  it("never waits for input or asks before overwriting", () => {
    expect(args.slice(0, 2)).toEqual(["-hide_banner", "-nostdin"]);
    expect(args).toContain("-y");
  });
});

describe("posterArgs", () => {
  const args = posterArgs("/tmp/in-1.mov", "/tmp/poster-1.jpg", plan());

  it("writes one JPEG frame of the first video stream", () => {
    expect(valueAfter(args, "-ss")).toEqual(["1"]);
    expect(valueAfter(args, "-map")).toEqual(["0:v:0"]);
    expect(valueAfter(args, "-frames:v")).toEqual(["1"]);
    expect(valueAfter(args, "-c:v")).toEqual(["mjpeg"]);
    expect(valueAfter(args, "-vf")).toEqual(["scale=1280:720"]);
    expect(args.at(-1)).toBe("/tmp/poster-1.jpg");
  });

  it("drops metadata from the poster too", () => {
    expect(valueAfter(args, "-map_metadata")).toEqual(["-1"]);
    expect(valueAfter(args, "-fflags")).toEqual(["+bitexact"]);
  });

  it("seeks before the input, so a long clip isn't decoded to find the frame", () => {
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
  });
});

describe("paths", () => {
  it("refuses a path ffmpeg would read as an option", () => {
    expect(() => transcodeArgs("-i", "/tmp/out.mp4", plan())).toThrow(
      RangeError
    );
    expect(() => posterArgs("/tmp/in.mov", "-y", plan())).toThrow(RangeError);
    expect(() => transcodeArgs("", "/tmp/out.mp4", plan())).toThrow(RangeError);
  });
});
