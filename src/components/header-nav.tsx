"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
} from "react";

import { buttonStyles } from "@/components/site/button-link";
import { isSignedInPath } from "@/lib/app-routes";
import { cn } from "@/lib/utils";

import styles from "./header-nav.module.css";
import { NavLink } from "./nav-link";
import { ThemeSwitch } from "./theme-toggle";

type Item = { href: string; label: string };

/**
 * The header's links, plus `dashboard` on pages behind sign-in: whoever
 * sees those is signed in. Public pages stay static, so the header never
 * reads the session to decide (#59).
 */
function withDashboard(
  items: Item[],
  dashboard: Item | undefined,
  pathname: string | null
): Item[] {
  return dashboard && pathname !== null && isSignedInPath(pathname)
    ? [...items, dashboard]
    : items;
}

// The current page gets a cue that doesn't rely on colour alone, in the
// section-blue heading colour (over 3:1 on the tint in both themes): an
// underline on desktop, a bar on the inline-start edge in the phone menu.
const DESKTOP_LINK =
  "min-h-11 rounded-full px-3.5 font-semibold text-ink-muted decoration-section-blue-heading decoration-3 underline-offset-6 hover:bg-surface-muted hover:text-ink aria-[current=page]:bg-section-blue aria-[current=page]:text-ink aria-[current=page]:underline";

const MENU_LINK =
  "relative flex min-h-12 w-full rounded-2xl px-4 text-lead font-semibold wrap-anywhere hover:bg-surface-muted aria-[current=page]:bg-section-blue aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-3 aria-[current=page]:before:start-1.5 aria-[current=page]:before:w-1 aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-section-blue-heading";

/** Desktop navigation (lg and up). */
export function DesktopNavView({
  items,
  dashboard,
  label,
  pathname,
}: {
  items: Item[];
  dashboard?: Item;
  label: string;
  pathname: string | null;
}) {
  return (
    <nav aria-label={label} data-desktop-nav className="hidden lg:block">
      <ul className="flex items-center gap-1">
        {withDashboard(items, dashboard, pathname).map((item) => (
          <li key={item.href}>
            <NavLink
              href={item.href}
              pathname={pathname}
              className={DESKTOP_LINK}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function DesktopNav(props: {
  items: Item[];
  dashboard?: Item;
  label: string;
}) {
  return <DesktopNavView {...props} pathname={usePathname()} />;
}

type MenuLabels = {
  menu: string;
  title: string;
  close: string;
  nav: string;
  donate: string;
  theme: string;
};

/** Ties the Menu and Close buttons to the dialog through invoker commands. */
const MENU_ID = "mobile-menu";
// Match the lg utilities that swap the menu trigger and desktop navigation.
const DESKTOP_MEDIA = "(min-width: 64rem)";

type MenuLinksProps = {
  items: Item[];
  dashboard?: Item;
  donateHref: string;
  pathname: string | null;
  close: () => void;
};

export function MenuLinksView({
  items,
  dashboard,
  pathname,
  close,
}: MenuLinksProps) {
  return (
    <ul className="flex flex-col gap-1">
      {withDashboard(items, dashboard, pathname).map((item) => (
        <li key={item.href}>
          <NavLink
            href={item.href}
            pathname={pathname}
            // The pathname effect closes the menu once the new page shows,
            // so the pending dot stays visible meanwhile. A link to the page
            // already showing closes it at once.
            onNavigate={item.href === pathname ? close : undefined}
            className={MENU_LINK}
          >
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * The links, marked for the current page. The menu closes whenever the
 * pathname changes, whether through one of its links, Back or Forward, so it
 * never lingers over another page.
 */
function MenuLinks(props: Omit<MenuLinksProps, "pathname">) {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const { close } = props;

  useEffect(() => {
    // The native command can open the dialog before this effect first runs.
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    close();
  }, [pathname, close]);

  return <MenuLinksView {...props} pathname={pathname} />;
}

function DonateLinkView({
  donateHref,
  pathname,
  close,
  children,
}: Omit<MenuLinksProps, "items" | "dashboard"> & { children: ReactNode }) {
  return (
    <NavLink
      href={donateHref}
      pathname={pathname}
      onNavigate={donateHref === pathname ? close : undefined}
      className={cn(buttonStyles({ size: "lg" }), "w-full")}
    >
      {children}
    </NavLink>
  );
}

function DonateLink(
  props: Omit<MenuLinksProps, "items" | "dashboard" | "pathname"> & {
    children: ReactNode;
  }
) {
  return <DonateLinkView {...props} pathname={usePathname()} />;
}

/**
 * Small screens: a native modal <dialog> (focus trap, Escape and inert page
 * for free).
 *
 * The button and the dialog sit outside any Suspense boundary, so the page's
 * first HTML holds the only copy of each. usePathname() can suspend on routes
 * with unknown params, and React may stream even a finished boundary
 * separately, revealing it on a timer after the first paint. A menu inside
 * such a boundary would be its fallback copy until then, and the reveal would
 * delete it, open or not, from under a tap made before hydration. Only the
 * parts marked for the current page sit in boundaries, inside the dialog.
 */
export function MobileMenu({
  items,
  dashboard,
  labels,
  donateHref,
}: {
  items: Item[];
  dashboard?: Item;
  labels: MenuLabels;
  donateHref: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => dialog.current?.close(), []);
  const links = { items, dashboard, donateHref, close };

  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_MEDIA);
    const closeOnDesktop = () => {
      const menu = dialog.current;
      if (!desktop.matches || !menu?.open) return;

      menu.close();
      // The native invoker is now hidden. Move focus into the visible nav.
      const nav = menu.closest("header")?.querySelector("[data-desktop-nav]");
      const link =
        nav?.querySelector<HTMLAnchorElement>('a[aria-current="page"]') ??
        nav?.querySelector<HTMLAnchorElement>("a");
      link?.focus({ preventScroll: true });
    };
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <>
      {/* The invoker command opens the menu before hydration (Chrome 135+,
          Safari 26.2+); onClick covers older browsers. Opening an open modal
          does nothing, so the two never clash. */}
      <button
        type="button"
        aria-haspopup="dialog"
        {...({ command: "show-modal", commandfor: MENU_ID } as object)}
        onClick={() => dialog.current?.showModal()}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-border-strong px-4 font-semibold text-ink hover:bg-surface-muted lg:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
        {/* The rem breakpoint grows with the browser's text size, so only
            large text reduces Menu to its icon. */}
        <span className="max-[20rem]:sr-only">{labels.menu}</span>
      </button>
      {/* Overscroll is contained on the dialog, its backdrop and the nav,
          so swipes never scroll the page behind. The backdrop colour is a
          literal (neutral-950 at 50%): before Safari 17.4 and Chrome 122,
          ::backdrop inherits no custom properties, so a token-based colour
          turned transparent there. */}
      <dialog
        ref={dialog}
        id={MENU_ID}
        aria-labelledby="mobile-menu-title"
        // Light dismiss (backdrop click) where supported; Escape and the
        // Close button work everywhere.
        closedby="any"
        className={cn(
          styles.dialog,
          "m-0 ms-auto h-dvh max-h-dvh w-[min(24rem,100%)] max-w-none overflow-y-auto overscroll-contain border-s border-border bg-background p-0 text-ink backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-[rgb(23_21_17/0.5)] open:flex open:flex-col"
        )}
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3 py-3 sm:px-5">
          <p
            id="mobile-menu-title"
            className="font-display text-h4 font-bold wrap-anywhere"
          >
            {labels.title}
          </p>
          <button
            type="button"
            {...({ command: "close", commandfor: MENU_ID } as object)}
            onClick={close}
            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full px-3 text-start font-semibold hover:bg-surface-muted sm:px-4"
          >
            <X aria-hidden="true" className="size-5 shrink-0" />
            <span className="min-w-0 wrap-anywhere">{labels.close}</span>
          </button>
        </div>
        <nav aria-label={labels.nav} className={cn(styles.nav, "px-3 py-4")}>
          <Suspense fallback={<MenuLinksView {...links} pathname={null} />}>
            <MenuLinks {...links} />
          </Suspense>
        </nav>
        <div className="shrink-0 border-t border-border p-3 sm:p-5">
          {/* From sm up the header shows its own theme button. */}
          <ThemeSwitch
            label={labels.theme}
            className="mb-3 max-[22rem]:gap-2 max-[22rem]:px-2 max-[22rem]:[&_svg]:hidden sm:hidden"
          />
          <Suspense
            fallback={
              <DonateLinkView {...links} pathname={null}>
                {labels.donate}
              </DonateLinkView>
            }
          >
            <DonateLink {...links}>{labels.donate}</DonateLink>
          </Suspense>
        </div>
      </dialog>
    </>
  );
}
