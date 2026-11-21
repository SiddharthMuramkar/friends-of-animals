import { describe, expect, it } from "vitest";

import { isSettingKey, SETTING_KEYS, SETTINGS } from "./catalogue";

describe("the settings catalogue", () => {
  it("holds the first settings with their documented defaults", () => {
    // #62 and HR-19: SMS off, 80G off, FCRA off, staff sessions 12 hours.
    expect(
      Object.fromEntries(
        SETTING_KEYS.map((key) => [key, SETTINGS[key].default])
      )
    ).toEqual({
      "auth.staffSessionHours": 12,
      "sms.enabled": false,
      "org.has80G": false,
      "org.fcraEnabled": false,
    });
  });

  it("names every key <group>.<name>, so it doubles as a message path", () => {
    for (const key of SETTING_KEYS) {
      expect(key).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
    }
  });

  it("gives every setting a default that passes its own schema", () => {
    for (const key of SETTING_KEYS) {
      const { schema, default: fallback } = SETTINGS[key];
      expect(schema.safeParse(fallback).success, key).toBe(true);
    }
  });

  it("recognises only catalogue keys", () => {
    expect(isSettingKey("sms.enabled")).toBe(true);
    expect(isSettingKey("sms.disabled")).toBe(false);
    expect(isSettingKey("toString")).toBe(false);
    expect(isSettingKey("__proto__")).toBe(false);
  });
});
