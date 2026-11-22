import { expect, it, vi } from "vitest";

import { MediaError } from "@/server/ports/media";
import { readMediaFixture } from "@/test/media-fixtures";
import { webpSize } from "@/test/webp";

import { processMediaInChild } from "./process-media";

const input = {
  bytes: readMediaFixture("iphoneHeic"),
  kinds: ["thumb_320", "display_1600"],
} as const;

it("decodes a HEIC and returns each WebP through the media process", async () => {
  const result = await processMediaInChild(60).processImage(input);
  expect(result.sniffedType).toBe("image/heic");
  expect(result.derivatives.map(({ bytes }) => webpSize(bytes))).toEqual([
    { width: 204, height: 320 },
    { width: 700, height: 1100 },
  ]);
});

it("terminates a media process at the deadline with a typed error", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const processing = processMediaInChild(60).processImage(input);
    const rejected = expect(processing).rejects.toMatchObject({
      name: MediaError.name,
      code: "media_timeout",
    });
    vi.advanceTimersByTime(60_000);
    await rejected;
  } finally {
    vi.useRealTimers();
  }
});
