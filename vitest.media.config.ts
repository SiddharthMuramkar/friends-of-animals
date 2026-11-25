// `pnpm test:media`: the video adapter against real ffmpeg/ffprobe (#86)
// and the PDF adapter against real Poppler (#96). Only worker-media installs them (Dockerfile, target
// worker-media), so run it there:
//
//   docker run --rm <a worker-media image> pnpm test:media
//
// FFMPEG and FFPROBE name other binaries, and FOA_MEDIA_TMPDIR another
// scratch folder, when they live elsewhere. `pnpm test` never runs these.

import { defineConfig } from "vitest/config";

import base from "./vitest.config";

export default defineConfig({
  resolve: base.resolve,
  test: {
    include: ["src/**/*.media.test.ts"],
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
  },
});
