import { defineConfig } from "vitest/config";

import base from "./vitest.config";

// `pnpm test:pg`: races between separate connections on a real, migrated
// PostgreSQL (CI's pg-concurrency job). See src/test/pg.ts. Same aliases
// and setup as `pnpm test`, without the PGlite template.
export default defineConfig({
  resolve: base.resolve,
  test: {
    include: ["src/**/*.pg.test.ts"],
    environment: "node",
    setupFiles: base.test?.setupFiles,
    // One file at a time, so lock waits counted on the shared database
    // are a single file's own.
    fileParallelism: false,
  },
});
