import { env } from "./env";

/**
 * Validates the environment (§13.9) as the server starts and exits on a bad
 * config, so a misconfigured deployment fails at start instead of answering
 * every request with a 500. Called from `register` in src/instrumentation.ts.
 */
export function validateEnvOrExit() {
  try {
    env();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
