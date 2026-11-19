import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/site/button-link";
import { SiteLink } from "@/components/site/site-link";
import { ThemeToggle } from "@/components/theme-toggle";
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
  const items = PRIMARY_NAV.map((r) => ({
    href: r.path,
    label: t(`links.${r.id}`),
  }));
  const menu = {
    items,
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
      {/* With very large text the row may wrap, and the logo may shrink,
          rather than push Menu off the screen. */}
      <div className="mx-auto flex min-h-(--header-height) max-w-7xl flex-wrap items-center gap-3 px-4 py-2 sm:px-6">
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
          <DesktopNav items={items} label={t("label")} />
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
