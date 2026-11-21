import { describe, expect, it } from "vitest";

import { settingValueFromForm } from "./form";
import { parseSettingValue } from "./values";

describe("settingValueFromForm", () => {
  it("reads an on/off choice", () => {
    expect(settingValueFromForm("sms.enabled", "true")).toBe(true);
    expect(settingValueFromForm("sms.enabled", "false")).toBe(false);
  });

  it("reads a whole number, ignoring surrounding spaces", () => {
    expect(settingValueFromForm("auth.staffSessionHours", " 8 ")).toBe(8);
    expect(settingValueFromForm("auth.staffSessionHours", "-3")).toBe(-3);
  });

  it.each([
    ["sms.enabled", null],
    ["sms.enabled", "on"],
    ["auth.staffSessionHours", ""],
    ["auth.staffSessionHours", "1.5"],
    ["auth.staffSessionHours", "1e3"],
    ["auth.staffSessionHours", "eight"],
  ] as const)("leaves %s = %j for the schema to refuse", (key, entry) => {
    expect(parseSettingValue(key, settingValueFromForm(key, entry))).toEqual({
      ok: false,
      error: "invalid_value",
      problem: { reason: "wrong_type" },
    });
  });
});
