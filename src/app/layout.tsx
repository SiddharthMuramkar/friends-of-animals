import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { siteUrl } from "@/env";
import { SITE } from "@/lib/site";
import { themeScript } from "@/lib/theme";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  // Feeds --font-sans in globals.css.
  variable: "--font-inter",
  display: "swap",
});

const socialImage = {
  url: SITE.socialImage,
  width: 1200,
  height: 630,
  alt: `${SITE.name} logo`,
};

export const metadata: Metadata = {
  // Social previews need absolute URLs; relative ones below resolve against it.
  metadataBase: siteUrl(),
  title: { default: SITE.name, template: `%s | ${SITE.name}` },
  description: SITE.tagline,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.name,
    description: SITE.tagline,
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.name,
    description: SITE.tagline,
    images: [socialImage],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/brand/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script changes the class before hydration.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col bg-background antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
