// What a setting's form shows after a save, from changeSetting's result or
// the error it threw, or where a refusal sends the user instead. Pure, so
// the mapping is tested without a page.

import { APP_ROUTES } from "@/lib/app-routes";
import { secondFactorPath } from "@/lib/second-factor-routes";
import { DomainError, type DomainErrorCode } from "@/server/errors";
import type {
  ChangeSettingResult,
  SettingValueProblem,
} from "@/server/modules/settings";

export type SettingRefusal = DomainErrorCode | "unknown_setting" | "failed";

export type SettingFormState =
  | { status: "idle" }
  /** Stored: the new value applies now. */
  | { status: "saved" }
  /** The value already applied: nothing stored. */
  | { status: "unchanged" }
  /** Refused by the setting's schema; `entered` is shown again to fix. */
  | { status: "invalid"; problem: SettingValueProblem; entered: string }
  | { status: "refused"; reason: SettingRefusal };

/** What a setting's form starts with, before its first save. */
export const IDLE: SettingFormState = { status: "idle" };

/** After changeSetting returned; `entered` is the submitted field. */
export function afterChange(
  result: ChangeSettingResult,
  entered: string
): SettingFormState {
  if (result.ok) return { status: result.changed ? "saved" : "unchanged" };
  if (result.error === "invalid_value") {
    return { status: "invalid", problem: result.problem, entered };
  }
  return { status: "refused", reason: result.error };
}

/** After changeSetting threw: a policy refusal by name, else "failed". */
export function afterError(error: unknown): SettingFormState {
  return {
    status: "refused",
    reason: error instanceof DomainError ? error.code : "failed",
  };
}

/**
 * Where a change refused for want of a second factor sends the user: to
 * step up, or to pass or add a second factor (#60), then back to the
 * settings to save again. Null for anything else, which the form says.
 */
export function secondFactorRedirect(error: unknown): string | null {
  if (!(error instanceof DomainError)) return null;
  return secondFactorPath(error.code, APP_ROUTES.adminSettings);
}
