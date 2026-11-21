import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { HeaderHeightSync } from "@/components/header-height-sync";
import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/site/button-link";
import { SiteLink } from "@/components/site/site-link";
import { SkipLink } from "@/components/site/skip-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_ROUTES } from "@/lib/app-routes";
import { PRIMARY_NAV, ROUTES } from "@/lib/routes";

import {
  DesktopNav,
  DesktopNavView,
  MobileMenu,
  MobileMenuView,
} from "./header-nav";

export async function SiteHeader() {
  const t = await getTranslations("nav");
  const tc = await getTranslations("common");
  const td = await getTranslations("dashboard");
  const items = PRIMARY_NAV.map((r) => ({
    href: r.path,
    label: t(`links.${r.id}`),
  }));
  // Shown on pages behind sign-in only (header-nav.tsx).
  const dashboard = { href: APP_ROUTES.dashboard, label: td("headerLink") };
  const menu = {
    items,
    dashboard,
    donateHref: ROUTES.donate.path,
    labels: {
      menu: t("menu"),
      title: t("menuTitle"),
      close: t("closeMenu"),
      nav: t("label"),
      donate: t("donate"),
      theme: tc("theme.switch"),
    },
  };

  return (
    // Pinned during page view transitions (globals.css).
    <header
      style={{ viewTransitionName: "site-header" }}
      className="sticky top-0 z-40 border-b border-border bg-background"
    >
      {/* First in the banner landmark, not loose in <body>: on /safeguarding
          Quick exit, an off-site link, comes before it, and axe then stops
          counting it as a skip link and flags it as content outside any
          landmark. It still comes first in tab order after Quick exit. */}
      <SkipLink>{tc("skipLink")}</SkipLink>
      <HeaderHeightSync />
      {/* With very large text the row may wrap, and the logo may shrink,
          rather than push Menu off the screen. The fixed min height (the
          --header-height default) stops the measured var feeding back. */}
      <div className="mx-auto flex min-h-18 max-w-7xl flex-wrap items-center gap-3 px-4 py-2 sm:px-6">
        <SiteLink
          href="/"
          aria-label={t("homeLink")}
          className="mr-auto min-w-0 rounded-xl lg:mr-4"
        >
          <Logo className="h-11 w-auto max-w-full object-contain object-left sm:h-12" />
        </SiteLink>
        {/* usePathname() can suspend on routes with unknown params. */}
        <Suspense
          fallback={
            <DesktopNavView items={items} label={t("label")} pathname={null} />
          }
        >
          <DesktopNav items={items} dashboard={dashboard} label={t("label")} />
        </Suspense>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ButtonLink href={ROUTES.donate.path} className="max-sm:hidden">
            {t("donate")}
          </ButtonLink>
          {/* On phones the theme switch is in the menu instead. */}
          <ThemeToggle
            className="max-sm:hidden"
            labels={{
              toDark: tc("theme.toDark"),
              toLight: tc("theme.toLight"),
              dark: tc("theme.dark"),
              light: tc("theme.light"),
            }}
          />
          <Suspense fallback={<MobileMenuView {...menu} pathname={null} />}>
            <MobileMenu {...menu} />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
