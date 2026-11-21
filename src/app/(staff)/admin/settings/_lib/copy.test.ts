import { describe, expect, it } from "vitest";

import { messages } from "@/i18n/messages";
import { SETTING_KEYS } from "@/server/settings/catalogue";

/** The copy at `path` (dot-separated) in the merged messages. */
function copyAt(path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages
    );
}

describe("the settings screen's copy", () => {
  it.each(SETTING_KEYS)("labels and describes %s", (key) => {
    const copy = copyAt(`adminSettings.settings.${key}`);
    expect(copy).toEqual({
      label: expect.stringMatching(/\S/),
      description: expect.stringMatching(/\S/),
    });
  });
});
