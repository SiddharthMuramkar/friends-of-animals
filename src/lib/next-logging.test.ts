import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import loadConfig from "next/dist/server/config";
import { expect, it } from "vitest";

it("disables Next development request and action logging for bearer links", async () => {
  const config = await loadConfig(PHASE_DEVELOPMENT_SERVER, process.cwd(), {
    silent: true,
  });
  expect(config.logging).toBe(false);
});
