// What a setting's form shows after a save, from changeSetting's result.
// Pure, so the mapping is tested without a page.

import type { ChangeSettingResult } from "@/server/settings";

export type SettingFormState = { status: "idle" };

export const IDLE: SettingFormState = { status: "idle" };

export function afterChange(
  _result: ChangeSettingResult,
  _entered: string
): SettingFormState {
  return IDLE;
}

export function afterError(_error: unknown): SettingFormState {
  return IDLE;
}
