import { describe, expect, it } from "vitest";

import { parseFfprobeOutput } from "./video-probe";

/** What `ffprobe -show_format -show_streams -of json` prints for an iPhone clip. */
const iphonePortrait = {
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "hevc",
      width: 1920,
      height: 1080,
      duration: "12.345000",
      side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }],
      tags: { creation_time: "2027-01-10T09:00:00.000000Z" },
    },
    { index: 1, codec_type: "audio", codec_name: "aac", duration: "12.400" },
    { index: 2, codec_type: "data", codec_name: "none" },
  ],
  format: {
    format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    duration: "12.400000",
    tags: { "com.apple.quicktime.location.ISO6709": "+12.97+077.59/" },
  },
};

describe("parseFfprobeOutput", () => {
  it("reads duration, codecs and the upright size of a rotated phone clip", () => {
    expect(parseFfprobeOutput(iphonePortrait)).toEqual({
      ok: true,
      probe: {
        durationMs: 12_400,
        width: 1080,
        height: 1920,
        rotation: 90,
        videoCodec: "hevc",
        audioCodec: "aac",
        formatName: "mov,mp4,m4a,3gp,3g2,mj2",
      },
    });
  });

  it("takes the rotation from an older ffprobe's rotate tag", () => {
    const result = parseFfprobeOutput({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1280,
          height: 720,
          tags: { rotate: "270" },
        },
      ],
      format: { format_name: "mov,mp4", duration: "3.0" },
    });
    expect(result).toMatchObject({
      ok: true,
      probe: { width: 720, height: 1280, rotation: 270, audioCodec: null },
    });
  });

  it("keeps the stored size when the clip is upside down", () => {
    const result = parseFfprobeOutput({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1280,
          height: 720,
          side_data_list: [{ side_data_type: "Display Matrix", rotation: 180 }],
        },
      ],
      format: { duration: "1" },
    });
    expect(result).toMatchObject({
      ok: true,
      probe: { width: 1280, height: 720, rotation: 180 },
    });
  });

  it("falls back to the video stream's duration, then to unknown", () => {
    const stream = {
      codec_type: "video",
      codec_name: "vp9",
      width: 640,
      height: 360,
    };
    expect(
      parseFfprobeOutput({
        streams: [{ ...stream, duration: "7.25" }],
        format: { duration: "N/A" },
      })
    ).toMatchObject({ ok: true, probe: { durationMs: 7_250 } });
    expect(parseFfprobeOutput({ streams: [stream], format: {} })).toMatchObject(
      { ok: true, probe: { durationMs: null, formatName: null } }
    );
  });

  it("ignores cover art when looking for the video", () => {
    const result = parseFfprobeOutput({
      streams: [
        {
          codec_type: "video",
          codec_name: "mjpeg",
          width: 600,
          height: 600,
          disposition: { attached_pic: 1 },
        },
        { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
      ],
      format: { duration: "2" },
    });
    expect(result).toMatchObject({
      ok: true,
      probe: { videoCodec: "h264", width: 1920 },
    });
  });

  it("says when there is no video to play", () => {
    expect(
      parseFfprobeOutput({
        streams: [{ codec_type: "audio", codec_name: "aac" }],
        format: { duration: "30" },
      })
    ).toEqual({ ok: false, reason: "no_video_stream" });
    expect(
      parseFfprobeOutput({
        streams: [
          {
            codec_type: "video",
            codec_name: "mjpeg",
            width: 600,
            height: 600,
            disposition: { attached_pic: 1 },
          },
        ],
        format: {},
      })
    ).toEqual({ ok: false, reason: "no_video_stream" });
  });

  it("calls anything that isn't ffprobe's JSON unreadable", () => {
    for (const output of [
      null,
      "garbage",
      {},
      { streams: "x" },
      {
        streams: [
          { codec_type: "video", codec_name: "h264", width: 0, height: 10 },
        ],
      },
      { streams: [{ codec_type: "video", codec_name: "h264" }] },
    ]) {
      expect(parseFfprobeOutput(output)).toEqual({
        ok: false,
        reason: "unreadable",
      });
    }
  });
});
