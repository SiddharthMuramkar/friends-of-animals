import { Baloo_2, Kalam } from "next/font/google";
import localFont from "next/font/local";

// Every font is defined once, here. With next/font/google, `subsets` only
// picks the files to preload: the CSS still declares a face per subset, so
// one stray glyph downloads another file. Devanagari stays a system font on
// non-Hindi pages (the end of globals.css).

/**
 * Body text. Preloaded. Self-hosted as the latin file alone (Inter 4.001,
 * wght 100–900, the latin subset Google Fonts serves; licence in
 * inter-OFL.txt): with Google's faces, the "ł" in one photo credit pulled
 * the 83 KB latin-ext file. Glyphs outside latin now use the system font.
 */
export const inter = localFont({
  src: "../assets/fonts/inter-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

/**
 * Headings, numbers and every ₹ amount. U+20B9 is only in Baloo's latin-ext
 * and Devanagari faces, so the display stack puts a local-only "Rupee Local"
 * face first (globals.css) and ₹ uses a system font instead of fetching
 * latin-ext. Variable 400–800. Preloaded. Baloo 2 runs ~16% small and has a
 * 1.6 em line box: always set line-height.
 */
export const baloo = Baloo_2({
  subsets: ["latin"],
  variable: "--font-baloo",
  display: "swap",
});

/** Handwritten accent for at most five words at a time. Never preloaded. */
export const kalam = Kalam({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-kalam",
  display: "swap",
  preload: false,
});

/** Classes for <html>: each family exposes its own CSS variable. */
export const fontVariables = `${inter.variable} ${baloo.variable} ${kalam.variable}`;
