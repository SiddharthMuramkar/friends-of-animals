// The ffmpeg video processor (the VideoProcessor half of ./media.ts, #86).
// worker-media runs it; only that image installs ffmpeg and ffprobe
// (Dockerfile, target worker-media).
//
// One call per video, in a private temporary folder it always removes:
//   1. the original is streamed to a file there (ffmpeg needs to seek: a
//      phone's MP4 often has its index at the end);
//   2. its first bytes name its one demuxer (mov or matroska), so ffmpeg
//      never probes it as any other format;
//   3. ffprobe reads its length, size, rotation and codecs
//      (../modules/files/domain/video-probe.ts), and the pure planner
//      (../modules/files/domain/video-transcode.ts) refuses a clip that is
//      too long before anything is decoded;
//   4. ffmpeg makes the watchable copy and the poster with the planner's
//      argument lists, which drop every piece of metadata.
//
// A clip that can't be taken rejects with a MediaError (final). Anything
// else (the process killed from outside, ffmpeg missing, a disk error)
// throws as it is, so the outbox tries the job again. The processes get
// only PATH (and NODE_ENV), never the worker's secrets, and are killed at
// their deadline.
//
// Loads under plain Node (the worker): relative imports only.

import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseFfprobeOutput } from "../modules/files/domain/video-probe";
import {
  sniffVideoType,
  VIDEO_SNIFF_BYTES,
} from "../modules/files/domain/video-sniff";
import {
  demuxerFor,
  planVideoTranscode,
  posterArgs,
  probeArgs,
  transcodeArgs,
} from "../modules/files/domain/video-transcode";
import { MediaError, type VideoProcessor } from "./media";

/** How one run of ffmpeg or ffprobe ended. */
export type ProcessRun = {
  /** Null when a signal ended it. */
  exitCode: number | null;
  /** True when it ran past its deadline and was killed. */
  timedOut: boolean;
  stdout: string;
};

/** Runs one command to its end, or kills it at `timeoutMs`. */
export type RunProcess = (
  command: string,
  args: readonly string[],
  options: { timeoutMs: number }
) => Promise<ProcessRun>;

/** ffprobe's JSON for one file is a few kilobytes; more is not a video. */
const MAX_STDOUT_BYTES = 1024 * 1024;

/** The real runner: spawn, with only PATH in its environment. */
export const spawnProcess: RunProcess = (command, args, { timeoutMs }) =>
  new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    };
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "ignore"],
      env,
    });
    let stdout = "";
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_STDOUT_BYTES) child.kill("SIGKILL");
    });
    child.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(deadline);
      resolve({ exitCode, timedOut, stdout });
    });
  });

export type FfmpegOptions = {
  run?: RunProcess;
  /** Where each call makes its private folder; the OS's by default. */
  tmpRoot?: string;
  ffmpeg?: string;
  ffprobe?: string;
};

/** ffprobe reads headers only: a minute is an outage. */
export const PROBE_TIMEOUT_MS = 60_000;

/** One frame, sought before decoding. */
export const POSTER_TIMEOUT_MS = 60_000;

/** Streams `source` to `path`; returns its first bytes, for sniffing. */
async function saveStream(
  source: ReadableStream<Uint8Array>,
  path: string
): Promise<Uint8Array> {
  const file = await open(path, "wx", 0o600);
  const reader = source.getReader();
  const head = new Uint8Array(VIDEO_SNIFF_BYTES);
  let headLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (headLength < head.length) {
        const part = value.subarray(0, head.length - headLength);
        head.set(part, headLength);
        headLength += part.length;
      }
      await file.write(value);
    }
  } finally {
    reader.releaseLock();
    await file.close();
  }
  return head.subarray(0, headLength);
}

/** Runs ffmpeg; a non-zero exit is a clip it can't decode. */
async function runFfmpeg(
  run: RunProcess,
  command: string,
  args: string[],
  timeoutMs: number
): Promise<void> {
  const result = await run(command, args, { timeoutMs });
  if (result.timedOut) throw new MediaError("media_timeout");
  if (result.exitCode === null) {
    throw new Error("ffmpeg was stopped by a signal before it finished");
  }
  if (result.exitCode !== 0) throw new MediaError("media_decode_failed");
}

export function ffmpegVideoProcessor(
  options: FfmpegOptions = {}
): VideoProcessor {
  const run = options.run ?? spawnProcess;
  const ffmpeg = options.ffmpeg ?? "ffmpeg";
  const ffprobe = options.ffprobe ?? "ffprobe";
  return {
    async processVideo({ source, maxDurationMs }) {
      const folder = await mkdtemp(
        join(options.tmpRoot ?? tmpdir(), "foa-video-")
      );
      try {
        const original = join(folder, "original");
        const sniffedType = sniffVideoType(await saveStream(source, original));
        if (!sniffedType) throw new MediaError("unsupported_type");
        const demuxer = demuxerFor(sniffedType);

        const probed = await run(ffprobe, probeArgs(original, demuxer), {
          timeoutMs: PROBE_TIMEOUT_MS,
        });
        if (probed.timedOut) throw new MediaError("media_timeout");
        if (probed.exitCode === null) {
          throw new Error("ffprobe was stopped by a signal before it finished");
        }
        if (probed.exitCode !== 0) throw new MediaError("media_decode_failed");
        let output: unknown;
        try {
          output = JSON.parse(probed.stdout);
        } catch {
          throw new MediaError("media_decode_failed");
        }
        const read = parseFfprobeOutput(output);
        if (!read.ok) {
          throw new MediaError(
            read.reason === "no_video_stream"
              ? "no_video_stream"
              : "media_decode_failed"
          );
        }
        const decision = planVideoTranscode(read.probe, { maxDurationMs });
        if (!decision.ok) throw new MediaError("video_too_long");
        const { plan } = decision;

        const copy = join(folder, "copy.mp4");
        const poster = join(folder, "poster.jpg");
        await runFfmpeg(
          run,
          ffmpeg,
          transcodeArgs(original, copy, plan, demuxer),
          plan.timeoutMs
        );
        await runFfmpeg(
          run,
          ffmpeg,
          posterArgs(original, poster, plan, demuxer),
          POSTER_TIMEOUT_MS
        );
        const [copyBytes, posterBytes] = await Promise.all([
          readFile(copy),
          readFile(poster),
        ]);
        if (copyBytes.length === 0 || posterBytes.length === 0) {
          throw new MediaError("media_decode_failed");
        }
        const capMs = plan.maxOutputS * 1000;
        return {
          sniffedType,
          probe: read.probe,
          derivatives: [
            {
              kind: "video_mp4",
              contentType: "video/mp4",
              width: plan.width,
              height: plan.height,
              durationMs:
                read.probe.durationMs === null
                  ? null
                  : Math.min(read.probe.durationMs, capMs),
              bytes: new Uint8Array(copyBytes),
            },
            {
              kind: "video_poster",
              contentType: "image/jpeg",
              width: plan.posterWidth,
              height: plan.posterHeight,
              durationMs: null,
              bytes: new Uint8Array(posterBytes),
            },
          ],
        };
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
  };
}
