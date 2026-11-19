import { Baloo_2, Inter, Kalam } from "next/font/google";

// Every font is defined once, here (type-colour.md §A.7). Latin subsets only:
// Devanagari would preload ~110 KB on every English page.

/** Body text. Preloaded. */
export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * Headings, numbers and every ₹ amount: the rupee sign is not in Inter's latin
 * subset and would pull its 83 KB latin-ext file. Variable 400–800. Preloaded.
 * Baloo 2 runs ~16% small and has a 1.6 em line box: always set line-height.
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
