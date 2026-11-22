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

import { CODE_REQUEST_LIMITS } from "../../identity/settings";
import {
  booleanSetting,
  integerSetting,
  type SettingDefinition,
  textSetting,
} from "./definition";

export const SETTINGS = {
  // Identity and access (#60): staff sessions are shorter than members'.
  "auth.staffSessionHours": integerSetting({
    default: 12,
    min: 1,
    max: 24,
    unit: "hours",
  }),
  // Sign-in by emailed code (#57). On by default, but production also
  // needs SES configured and out of its sandbox (src/server/deps.ts,
  // DECISIONS R-27); until then sign-in says it opens soon.
  "auth.emailSignIn": booleanSetting({ default: true }),
  // Messages (#58): off until DLT registration through MSG91 (HR-14).
  // Seeded on for local runs and previews, which capture every text.
  "sms.enabled": booleanSetting({ default: false }),
  // Ceilings on sign-in texts to everyone together, so a pool of networks
  // can't text thousands of numbers on FOA's bill (#58, HR-19).
  "sms.maxPerHour": integerSetting({
    default: CODE_REQUEST_LIMITS.smsPerHour,
    min: 1,
    max: 1000,
    unit: "texts",
  }),
  "sms.maxPerDay": integerSetting({
    default: CODE_REQUEST_LIMITS.smsPerDay,
    min: 1,
    max: 5000,
    unit: "texts",
  }),
  // Organisation facts. Off until FOA holds 80G (HR-16) and is registered
  // under FCRA; they gate tax receipts and foreign donations (M5).
  "org.has80G": booleanSetting({ default: false }),
  "org.fcraEnabled": booleanSetting({ default: false }),
  // FOA's tax and registration facts (#111): they go on receipts, so a
  // super admin sets them. Empty until FOA confirms each one (HR-21); the
  // site shows "To be confirmed" until then, and production leaves it out.
  "org.legalName": textSetting({ default: "", maxLength: 200 }),
  "org.registrationType": textSetting({ default: "", maxLength: 100 }),
  "org.registrationNumber": textSetting({ default: "", maxLength: 50 }),
  "org.pan": textSetting({ default: "", maxLength: 10 }),
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
