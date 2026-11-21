// The settings module (#62): runtime settings a super admin changes
// without a deploy, and the typed accessor app code reads them through.
// Its use cases join `as(actor)` through `settingsUseCases`.

import type { UseCaseContext } from "../use-cases";
import { listSettings } from "./use-cases";

export type { SettingKey, SettingValue } from "./catalogue";
export { readSetting } from "./read";

export const settingsUseCases = (ctx: UseCaseContext) => ({
  listSettings: () => listSettings(ctx),
});
