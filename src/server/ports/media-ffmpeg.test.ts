// The ffmpeg adapter's own logic, with the processes faked at RunProcess:
// what it runs, in which order, with which deadline, and what each way a
// run can end becomes. Real ffmpeg runs it in ./media-ffmpeg.media.test.ts.

import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readMediaFixture } from "@/test/media-fixtures";

import { MediaError } from "./media";
import { expectMediaError, streamOf } from "./media.contract";
import {
  ffmpegVideoProcessor,
  POSTER_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  type ProcessRun,
  type RunProcess,
} from "./media-ffmpeg";

/** ffprobe's answer for a 40 s 4K phone clip turned a quarter. */
function probeJson({
  duration = "40.000000",
  video = true,
}: { duration?: string; video?: boolean } = {}) {
  return JSON.stringify({
    streams: [
      ...(video
        ? [
            {
              codec_type: "video",
              codec_name: "hevc",
              width: 3840,
              height: 2160,
              side_data_list: [
                { side_data_type: "Display Matrix", rotation: -90 },
              ],
              tags: { creation_time: "2026-11-01T10:00:00Z" },
            },
          ]
        : []),
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration,
      tags: { "com.apple.quicktime.location.ISO6709": "+18.9220+072.8347/" },
    },
  });
}

type Call = { command: string; args: readonly string[]; timeoutMs: number };

/**
 * A runner that answers ffprobe with `probe` and ffmpeg with `ffmpeg`
 * (writing the output file it names), recording every call.
 */
function fakeRunner({
  probe = { exitCode: 0, timedOut: false, stdout: probeJson() },
  ffmpeg = () => ({ exitCode: 0, timedOut: false, stdout: "" }),
}: {
  probe?: ProcessRun;
  ffmpeg?: (call: Call) => ProcessRun;
} = {}) {
  const calls: Call[] = [];
  const run: RunProcess = async (command, args, { timeoutMs }) => {
    const call = { command, args, timeoutMs };
    calls.push(call);
    if (command === "ffprobe") return probe;
    const result = ffmpeg(call);
    if (result.exitCode === 0 && !result.timedOut) {
      await writeFile(args.at(-1)!, Uint8Array.from([1, 2, 3]));
    }
    return result;
  };
  return { run, calls };
}

async function setup(runner = fakeRunner()) {
  const tmpRoot = await mkdtemp(join(tmpdir(), "foa-ffmpeg-test-"));
  const processor = ffmpegVideoProcessor({ run: runner.run, tmpRoot });
  const process = (fixture: "gpsMov" | "clipWebm" | "gpsJpeg" = "gpsMov") =>
    processor.processVideo({
      source: streamOf(readMediaFixture(fixture)),
      maxDurationMs: 180_000,
    });
  return { ...runner, tmpRoot, process };
}

describe("ffmpegVideoProcessor", () => {
  it("probes, then makes the copy and the poster from the saved original", async () => {
    const { calls, process, tmpRoot } = await setup();

    const result = await process();

    expect(calls.map(({ command }) => command)).toEqual([
      "ffprobe",
      "ffmpeg",
      "ffmpeg",
    ]);
    const original = calls[0]!.args.at(-1)!;
    expect(original.startsWith(join(tmpRoot, "foa-video-"))).toBe(true);
    // Opened with the one demuxer its bytes name, everywhere.
    for (const call of calls) {
      expect(call.args[call.args.indexOf("-f") + 1]).toBe("mov");
    }
    expect(calls[1]!.args).toContain(original);
    expect(calls[1]!.args.at(-1)!.endsWith("copy.mp4")).toBe(true);
    expect(calls[2]!.args.at(-1)!.endsWith("poster.jpg")).toBe(true);
    // A 40 s clip: max(2 min, 4 x 40 s) + 1 min.
    expect(calls.map(({ timeoutMs }) => timeoutMs)).toEqual([
      PROBE_TIMEOUT_MS,
      220_000,
      POSTER_TIMEOUT_MS,
    ]);
    expect(result.sniffedType).toBe("video/quicktime");
    expect(result.probe).toMatchObject({
      durationMs: 40_000,
      width: 2160,
      height: 3840,
    });
    expect(
      result.derivatives.map(({ bytes: _bytes, ...rest }) => rest)
    ).toEqual([
      {
        kind: "video_mp4",
        contentType: "video/mp4",
        width: 1080,
        height: 1920,
        durationMs: 40_000,
      },
      {
        kind: "video_poster",
        contentType: "image/jpeg",
        width: 720,
        height: 1280,
        durationMs: null,
      },
    ]);
    // Its private folder is gone.
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("opens a WebM with the Matroska demuxer only", async () => {
    const { calls, process } = await setup();
    await process("clipWebm");
    for (const call of calls) {
      expect(call.args[call.args.indexOf("-f") + 1]).toBe("matroska");
    }
  });

  it("refuses bytes that aren't a video before running anything", async () => {
    const { calls, process, tmpRoot } = await setup();
    await expectMediaError(process("gpsJpeg"), "unsupported_type");
    expect(calls).toEqual([]);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("refuses a clip ffprobe measures past the limit, before decoding it", async () => {
    const { calls, process } = await setup(
      fakeRunner({
        probe: {
          exitCode: 0,
          timedOut: false,
          stdout: probeJson({ duration: "181.001" }),
        },
      })
    );
    await expectMediaError(process(), "video_too_long");
    expect(calls.map(({ command }) => command)).toEqual(["ffprobe"]);
  });

  it.each([
    [
      "no picture in it",
      { exitCode: 0, timedOut: false, stdout: probeJson({ video: false }) },
      "no_video_stream",
    ],
    [
      "ffprobe can't read it",
      { exitCode: 1, timedOut: false, stdout: "" },
      "media_decode_failed",
    ],
    [
      "ffprobe answers something else than JSON",
      { exitCode: 0, timedOut: false, stdout: "not json" },
      "media_decode_failed",
    ],
    [
      "ffprobe runs past its deadline",
      { exitCode: null, timedOut: true, stdout: "" },
      "media_timeout",
    ],
  ] as const)("refuses a clip with %s", async (_, probe, code) => {
    const { process, tmpRoot } = await setup(fakeRunner({ probe }));
    await expectMediaError(process(), code);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("refuses a clip ffmpeg can't decode, or that runs past its deadline", async () => {
    const failing = await setup(
      fakeRunner({
        ffmpeg: () => ({ exitCode: 1, timedOut: false, stdout: "" }),
      })
    );
    await expectMediaError(failing.process(), "media_decode_failed");
    const slow = await setup(
      fakeRunner({
        ffmpeg: () => ({ exitCode: null, timedOut: true, stdout: "" }),
      })
    );
    await expectMediaError(slow.process(), "media_timeout");
    expect(await readdir(slow.tmpRoot)).toEqual([]);
  });

  it("throws, to be tried again, when ffmpeg is stopped from outside", async () => {
    const { process, tmpRoot } = await setup(
      fakeRunner({
        ffmpeg: () => ({ exitCode: null, timedOut: false, stdout: "" }),
      })
    );
    const error = await process().then(
      () => undefined,
      (reason: unknown) => reason
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(MediaError);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("throws, to be tried again, when ffprobe can't be started", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "foa-ffmpeg-test-"));
    const processor = ffmpegVideoProcessor({
      tmpRoot,
      ffprobe: join(tmpRoot, "no-such-ffprobe"),
    });
    const error = await processor
      .processVideo({
        source: streamOf(readMediaFixture("gpsMov")),
        maxDurationMs: 180_000,
      })
      .then(
        () => undefined,
        (reason: unknown) => reason
      );
    expect(error).toMatchObject({ code: "ENOENT" });
    expect(error).not.toBeInstanceOf(MediaError);
    expect(await readdir(tmpRoot)).toEqual([]);
  });
});
