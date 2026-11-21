// The settings module (#62): runtime settings a super admin changes
// without a deploy, and the typed accessor app code reads them through.

export type { SettingKey, SettingValue } from "./catalogue";
export { readSetting } from "./read";
