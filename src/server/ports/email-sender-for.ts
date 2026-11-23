// Which email adapter an environment uses. Shared by the app
// (src/server/deps.ts) and the VPS worker (src/worker), so both send the
// same way.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import type { Env } from "../../env.schema";
import type { DbWithClock } from "../db/app-db";
import { unconfiguredEmailSender, type EmailSender } from "./email";
import { captureEmailSender } from "./email-capture";
import { sesEmailSender, type SesConfig, type SesTransport } from "./email-ses";

/** SES's variables (src/env.schema.ts), any of them unset. */
export type SesVariables = {
  SES_REGION?: string | undefined;
  SES_ACCESS_KEY_ID?: string | undefined;
  SES_SECRET_ACCESS_KEY?: string | undefined;
  SES_FROM?: string | undefined;
  SES_CONFIGURATION_SET?: string | undefined;
};

/** FOA's SES region, as in the env schema's default. */
const DEFAULT_SES_REGION = "ap-south-1";

/**
 * The SES adapter's config, or null while SES isn't configured: its key
 * id, secret and sender come together (the env schema allows all or none).
 */
export function sesConfigOf(env: SesVariables): SesConfig | null {
  const { SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_FROM } = env;
  if (!SES_ACCESS_KEY_ID || !SES_SECRET_ACCESS_KEY || !SES_FROM) return null;
  return {
    region: env.SES_REGION ?? DEFAULT_SES_REGION,
    accessKeyId: SES_ACCESS_KEY_ID,
    secretAccessKey: SES_SECRET_ACCESS_KEY,
    from: SES_FROM,
    configurationSet: env.SES_CONFIGURATION_SET,
  };
}

/**
 * Production sends real email through SES once its variables are set;
 * until then it refuses. Every other environment captures, so no real
 * email leaves staging, previews or a local run, codes stay readable, and
 * SES is never called there. `transport` is for tests (a fake SES).
 */
export function emailSenderFor(
  appEnv: Env["APP_ENV"],
  deps: DbWithClock,
  ses: SesVariables,
  transport?: SesTransport
): EmailSender {
  if (appEnv !== "production") return captureEmailSender(deps);
  const config = sesConfigOf(ses);
  if (!config) return unconfiguredEmailSender;
  return sesEmailSender(config, transport);
}
