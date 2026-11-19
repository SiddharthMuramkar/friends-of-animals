/** localStorage key holding the visitor's choice: "dark" or "light". */
export const THEME_STORAGE_KEY = "foa-theme";

/**
 * The browser toolbar colour (`theme-color`) for each theme: the page
 * background, neutral-50 and neutral-950 in globals.css.
 */
export const THEME_COLORS = { light: "#FEFAF2", dark: "#171511" } as const;

const THEME_COLOR_META = 'meta[name="theme-color"]';

/**
 * Inline <head> script that applies a saved dark theme before first paint,
 * so dark-mode visitors don't see a flash of the light theme. Light is the
 * default whatever the OS setting.
 *
 * For the toolbar it adds its own dark theme-color meta ahead of the
 * layout's light one (the first one wins) instead of editing that one:
 * React matches the layout's meta by its content when it hydrates, and
 * would add a second, light one if the content had changed.
 */
export const themeScript = `(function () {
  try {
    if (localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) !== "dark") return;
    document.documentElement.classList.add("dark");
    var meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = ${JSON.stringify(THEME_COLORS.dark)};
    document.head.insertBefore(meta, document.querySelector(${JSON.stringify(THEME_COLOR_META)}));
  } catch (e) {}
})();`;

/** Points every theme-color meta at the theme's colour, adding one if none. */
export function syncThemeColor(dark: boolean): void {
  const color = dark ? THEME_COLORS.dark : THEME_COLORS.light;
  const metas = document.querySelectorAll<HTMLMetaElement>(THEME_COLOR_META);
  if (metas.length === 0) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    document.head.append(meta);
  }
  for (const meta of metas) meta.content = color;
}

/**
 * Switches the theme: the `dark` class on <html> (the source of truth for
 * styles), the toolbar colour and the saved choice.
 */
export function setTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  syncThemeColor(dark);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    // Storage can be unavailable (private mode); the switch still applies.
  }
}
