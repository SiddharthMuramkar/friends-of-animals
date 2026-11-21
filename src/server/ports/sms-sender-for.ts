// Which SMS adapter an environment uses. Shared by the app
// (src/server/deps.ts) and the VPS worker (src/worker), so both send the
// same way, as ./email-sender-for.ts does for email.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import type { Env } from "../../env.schema";
import type { DbWithClock } from "../db/app-db";
import { unconfiguredSmsSender, type SmsSender } from "./sms";
import { captureSmsSender } from "./sms-capture";
import { msg91SmsSender } from "./sms-msg91";

/** MSG91's auth key and the id of each DLT-approved template. */
export type Msg91Settings = {
  authKey?: string | undefined;
  otpTemplateId?: string | undefined;
  coordinatorInvitationTemplateId?: string | undefined;
};

/**
 * Production sends real SMS through MSG91 once its keys are set (after
 * FOA's DLT registration); until then it refuses. Every other environment
 * captures, so no real SMS leaves staging, previews or a local run, and
 * MSG91 is never called there. A template DLT hasn't approved yet (no id)
 * is refused by the MSG91 adapter on its own.
 */
export function smsSenderFor(
  appEnv: Env["APP_ENV"],
  deps: DbWithClock,
  msg91: Msg91Settings,
  fetchImpl: typeof fetch = fetch
): SmsSender {
  if (appEnv !== "production") return captureSmsSender(deps);
  if (!msg91.authKey || !msg91.otpTemplateId) return unconfiguredSmsSender;
  return msg91SmsSender(
    {
      authKey: msg91.authKey,
      templates: {
        "sign-in-code": msg91.otpTemplateId,
        "coordinator-invitation": msg91.coordinatorInvitationTemplateId,
      },
    },
    fetchImpl
  );
}
