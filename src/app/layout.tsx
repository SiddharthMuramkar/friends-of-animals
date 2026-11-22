import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ViewTransition } from "react";

import { UmamiAnalytics } from "@/components/analytics/umami-analytics";
import { HistoryScrollGuard } from "@/components/site/history-scroll-guard";
import { JsonLd } from "@/components/site/json-ld";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { siteUrl } from "@/env";
import { LOCALE } from "@/i18n/formats";
import { fontVariables } from "@/lib/fonts";
import { PAGE_TRANSITION_CLASS } from "@/lib/page-transition";
import {
  DEFAULT_SOCIAL_IMAGE,
  organizationJsonLd,
  TITLE_TEMPLATE,
} from "@/lib/seo";
import { SITE } from "@/lib/site";
import { THEME_COLORS, themeScript } from "@/lib/theme";

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
      // Only the ICO: its frames are hinted per size (scripts/brand-logo.ts),
      // and browsers prefer an SVG over it when both are offered.
      icon: [{ url: "/favicon.ico?v=2", sizes: "16x16 24x24 32x32 48x48" }],
      apple: "/brand/apple-touch-icon.png",
    },
  };
}

export default async function RootLayout({ children, exit }: LayoutProps<"/">) {
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
        {/* The toolbar colour follows the site theme, not the OS setting, so
            it lives here rather than in Next's per-route viewport metadata,
            and the theme script and toggle keep it in step. */}
        <meta name="theme-color" content={THEME_COLORS.light} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        {/* The @exit slot (Quick exit on /safeguarding) comes first in tab
            order, before the skip link and header (GOV.UK "Exit this page").
            CSS order puts it back under the header; body is its sticky
            containing block, so it stays on screen over the footer too. */}
        {exit}
        {/* The skip link is the header's first child (site-header.tsx). */}
        <SiteHeader />
        <div className="order-2 flex flex-1 flex-col">
          <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
            {/* A link to another page cross-fades, and nothing else starts a
                view transition (page-transition.ts); the header is pinned
                (globals.css). */}
            <ViewTransition default={PAGE_TRANSITION_CLASS}>
              {children}
            </ViewTransition>
          </main>
          <SiteFooter />
        </div>
        <HistoryScrollGuard />
        <JsonLd data={organizationJsonLd(siteUrl(), t("tagline"))} />
        <UmamiAnalytics />
      </body>
    </html>
  );
}
