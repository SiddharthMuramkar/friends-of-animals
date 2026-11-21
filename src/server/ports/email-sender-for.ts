// Which email adapter an environment uses. Shared by the app
// (src/server/deps.ts) and the VPS worker (src/worker), so both send the
// same way.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import type { Env } from "../../env.schema";
import type { DbWithClock } from "../db/app-db";
import { unconfiguredEmailSender, type EmailSender } from "./email";
import { captureEmailSender } from "./email-capture";

/**
 * Production sends real email (SES, once FOA's account exists; until then
 * it refuses). Every other environment captures, so no real email leaves
 * staging, previews or a local run, and codes stay readable.
 */
export function emailSenderFor(
  appEnv: Env["APP_ENV"],
  deps: DbWithClock
): EmailSender {
  return appEnv === "production"
    ? unconfiguredEmailSender
    : captureEmailSender(deps);
}
