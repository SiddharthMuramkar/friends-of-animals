import type { Metadata, Viewport } from "next";
import { getTranslations } from "next-intl/server";
import { ViewTransition } from "react";

import { JsonLd } from "@/components/site/json-ld";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { siteUrl } from "@/env";
import { LOCALE } from "@/i18n/formats";
import { fontVariables } from "@/lib/fonts";
import {
  DEFAULT_SOCIAL_IMAGE,
  organizationJsonLd,
  TITLE_TEMPLATE,
} from "@/lib/seo";
import { SITE } from "@/lib/site";
import { themeScript } from "@/lib/theme";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    // Social previews need absolute URLs; relative ones resolve against it.
    metadataBase: siteUrl(),
    title: { default: SITE.name, template: TITLE_TEMPLATE },
    description: t("tagline"),
    openGraph: {
      type: "website",
      siteName: SITE.name,
      locale: "en_IN",
      title: SITE.name,
      description: t("tagline"),
      images: [DEFAULT_SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: SITE.name,
      description: t("tagline"),
      images: [DEFAULT_SOCIAL_IMAGE],
    },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "32x32" },
        { url: "/brand/favicon.svg", type: "image/svg+xml" },
      ],
      apple: "/brand/apple-touch-icon.png",
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FEFAF2" },
    { media: "(prefers-color-scheme: dark)", color: "#171511" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("common");
  return (
    // The theme script changes the class before hydration.
    <html
      lang={LOCALE}
      className={fontVariables}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only rounded-full bg-primary px-5 py-3 font-semibold text-primary-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
        >
          {t("skipLink")}
        </a>
        <SiteHeader />
        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          {/* Page changes cross-fade; the header is pinned (globals.css). */}
          <ViewTransition>{children}</ViewTransition>
        </main>
        <SiteFooter />
        <JsonLd data={organizationJsonLd(siteUrl(), t("tagline"))} />
      </body>
    </html>
  );
}
