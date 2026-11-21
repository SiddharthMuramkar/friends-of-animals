// Every runtime setting, in the order the settings screen lists them. A
// super admin changes them without a deploy; app code reads them with
// their default applied when nothing is stored.
//
// Keys are `<group>.<name>` in camelCase, so each one is also the path of
// its label and description in messages/en-IN/adminSettings.json. A ticket
// that adds a setting appends it to its group here.
//
// Loads under plain Node (the seed script): no "server-only", no "@/"
// imports.

import {
  booleanSetting,
  integerSetting,
  type SettingDefinition,
} from "./definition";

export const SETTINGS = {
  // Identity and access (#60): staff sessions are shorter than members'.
  "auth.staffSessionHours": integerSetting({
    default: 12,
    min: 1,
    max: 24,
    unit: "hours",
  }),
  // Messages (#58): off until DLT registration through MSG91 (HR-14).
  "sms.enabled": booleanSetting({ default: false }),
  // Organisation facts. Off until FOA holds 80G (HR-16) and is registered
  // under FCRA; they gate tax receipts and foreign donations (M5).
  "org.has80G": booleanSetting({ default: false }),
  "org.fcraEnabled": booleanSetting({ default: false }),
} satisfies Record<string, SettingDefinition<unknown>>;

export type SettingKey = keyof typeof SETTINGS;

/** The type of a setting's value, from its definition. */
export type SettingValue<K extends SettingKey> =
  (typeof SETTINGS)[K]["default"];

/** Every key, in the order the settings screen lists them. */
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

/** Whether `key` names a setting in the catalogue. */
export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}
