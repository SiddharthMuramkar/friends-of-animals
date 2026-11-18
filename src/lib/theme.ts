/** localStorage key holding the visitor's choice: "dark" or "light". */
export const THEME_STORAGE_KEY = "foa-theme";

/**
 * Inline <head> script that applies a saved dark theme before first paint,
 * so dark-mode visitors don't see a flash of the light theme.
 */
export const themeScript = `(function () {
  try {
    if (localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) === "dark") {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {}
})();`;
