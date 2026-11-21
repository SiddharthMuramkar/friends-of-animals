// The settings screen posts each value as a form field. This turns the
// field into the typed value `changeSetting` expects, by the setting's
// input kind. Anything it can't read is passed on unchanged, so the
// setting's schema refuses it with a reason the screen can show.
//
// Loads under plain Node: no "server-only", no "@/" imports.

import { SETTINGS, type SettingKey } from "./catalogue";

const WHOLE_NUMBER = /^-?\d+$/;

/** The submitted value for `key` from its form field. */
export function settingValueFromForm(
  key: SettingKey,
  entry: FormDataEntryValue | null
): unknown {
  if (typeof entry !== "string") return entry;
  const text = entry.trim();
  switch (SETTINGS[key].input.kind) {
    case "boolean":
      if (text === "true") return true;
      if (text === "false") return false;
      return text;
    case "integer":
      return WHOLE_NUMBER.test(text) ? Number(text) : text;
  }
}
