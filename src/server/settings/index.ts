// The settings module (#62): runtime settings a super admin changes
// without a deploy, and the typed accessor app code reads them through.
// Its use cases join `as(actor)` through `settingsUseCases`.

import type { UseCaseContext } from "../use-cases";
import {
  changeSetting,
  listSettings,
  type ChangeSettingInput,
} from "./use-cases";

export type { SettingKey, SettingValue } from "./catalogue";
export type { SettingInput } from "./definition";
export type { SettingValueProblem } from "./values";
export { readSetting } from "./read";
export type {
  ChangeSettingInput,
  ChangeSettingResult,
  SettingView,
} from "./use-cases";

export const settingsUseCases = (ctx: UseCaseContext) => ({
  listSettings: () => listSettings(ctx),
  changeSetting: (input: ChangeSettingInput) => changeSetting(ctx, input),
});
