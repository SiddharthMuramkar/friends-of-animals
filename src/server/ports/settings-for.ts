// The runtime settings an environment reads. Shared by the app
// (src/server/deps.ts) and the VPS worker (src/worker), so both decide the
// same way, for instance whether a message may go by SMS.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import type { Env } from "../../env.schema";
import { fixedSettings, type Settings } from "./settings";

/**
 * The runtime settings each deployment reads until #62's settings table
 * holds them. Local runs and previews send SMS to the capture mailbox, so
 * sign-in by phone is on there (the Seam 2 journey uses it); staging and
 * production keep the default, off, until DLT approval (HR-14).
 */
export function settingsFor(appEnv: Env["APP_ENV"]): Settings {
  return appEnv === "local" || appEnv === "preview"
    ? fixedSettings({ "sms.enabled": true })
    : fixedSettings();
}
