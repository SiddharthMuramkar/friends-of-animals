// `pnpm test:live`: provider contracts against real services (the R2
// bucket), run by hand with credentials. `pnpm test` never runs them.

import { defineConfig } from "vitest/config";

import base from "./vitest.config";

export default defineConfig({
  resolve: base.resolve,
  test: {
    include: ["src/**/*.live.test.ts"],
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    // Real network round trips, and the expiry checks wait for real.
    testTimeout: 30_000,
  },
});
