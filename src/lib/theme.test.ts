import { afterEach, describe, expect, it, vi } from "vitest";

import {
  setTheme,
  syncThemeColor,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  themeScript,
} from "./theme";

type Meta = { name: string; content: string };

/** Just enough of `document` and `localStorage` for the theme code. */
function fakeBrowser({
  stored = null,
  metas = [{ name: "theme-color", content: THEME_COLORS.light }],
  storageThrows = false,
}: {
  stored?: string | null;
  metas?: Meta[];
  storageThrows?: boolean;
} = {}) {
  const classes = new Set<string>();
  const head: Meta[] = [...metas];
  const themeColors = () => head.filter((m) => m.name === "theme-color");
  const saved = new Map<string, string>();
  if (stored) saved.set(THEME_STORAGE_KEY, stored);

  const document = {
    documentElement: {
      classList: {
        add: (c: string) => classes.add(c),
        toggle: (c: string, on: boolean) =>
          on ? classes.add(c) : classes.delete(c),
      },
    },
    createElement: (): Meta => ({ name: "", content: "" }),
    querySelector: () => themeColors()[0] ?? null,
    querySelectorAll: themeColors,
    head: {
      insertBefore: (node: Meta, before: Meta | null) =>
        head.splice(before ? head.indexOf(before) : head.length, 0, node),
      append: (node: Meta) => head.push(node),
    },
  };
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("blocked");
      return saved.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (storageThrows) throw new Error("blocked");
      saved.set(key, value);
    },
  };
  return { document, localStorage, classes, head, themeColors, saved };
}

function runThemeScript(browser: ReturnType<typeof fakeBrowser>) {
  // oxlint-disable-next-line typescript/no-implied-eval -- runs the inline script as the browser would
  new Function("document", "localStorage", themeScript)(
    browser.document,
    browser.localStorage
  );
}

describe("themeScript", () => {
  it("leaves the light default alone when nothing is saved", () => {
    const browser = fakeBrowser();
    runThemeScript(browser);
    expect(browser.classes.has("dark")).toBe(false);
    expect(browser.themeColors().map((m) => m.content)).toEqual([
      THEME_COLORS.light,
    ]);
  });

  it("applies a saved dark theme, with a dark toolbar meta first", () => {
    const browser = fakeBrowser({ stored: "dark" });
    runThemeScript(browser);
    expect(browser.classes.has("dark")).toBe(true);
    // The layout's meta keeps its content, so React can still match it.
    expect(browser.themeColors().map((m) => m.content)).toEqual([
      THEME_COLORS.dark,
      THEME_COLORS.light,
    ]);
  });

  it("adds the meta even when the layout's one isn't parsed yet", () => {
    const browser = fakeBrowser({ stored: "dark", metas: [] });
    runThemeScript(browser);
    expect(browser.themeColors().map((m) => m.content)).toEqual([
      THEME_COLORS.dark,
    ]);
  });

  it("ignores a saved light theme and blocked storage", () => {
    const light = fakeBrowser({ stored: "light" });
    runThemeScript(light);
    expect(light.classes.has("dark")).toBe(false);

    const blocked = fakeBrowser({ storageThrows: true });
    expect(() => runThemeScript(blocked)).not.toThrow();
    expect(blocked.classes.has("dark")).toBe(false);
  });
});

describe("setTheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stub(browser: ReturnType<typeof fakeBrowser>) {
    vi.stubGlobal("document", browser.document);
    vi.stubGlobal("localStorage", browser.localStorage);
  }

  it("sets the class, every toolbar meta and the saved choice", () => {
    const browser = fakeBrowser({ stored: "dark" });
    runThemeScript(browser);
    stub(browser);

    setTheme(false);
    expect(browser.classes.has("dark")).toBe(false);
    expect(browser.themeColors().map((m) => m.content)).toEqual([
      THEME_COLORS.light,
      THEME_COLORS.light,
    ]);
    expect(browser.saved.get(THEME_STORAGE_KEY)).toBe("light");

    setTheme(true);
    expect(browser.classes.has("dark")).toBe(true);
    expect(browser.themeColors().map((m) => m.content)).toEqual([
      THEME_COLORS.dark,
      THEME_COLORS.dark,
    ]);
    expect(browser.saved.get(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("still switches when storage is blocked", () => {
    const browser = fakeBrowser({ storageThrows: true });
    stub(browser);
    expect(() => setTheme(true)).not.toThrow();
    expect(browser.classes.has("dark")).toBe(true);
  });

  it("adds a toolbar meta if there is none", () => {
    const browser = fakeBrowser({ metas: [] });
    stub(browser);
    syncThemeColor(true);
    expect(browser.themeColors().map((m) => m.content)).toEqual([
      THEME_COLORS.dark,
    ]);
  });
});
