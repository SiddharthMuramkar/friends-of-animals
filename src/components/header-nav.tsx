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
import { cn } from "@/lib/utils";

import { NavLink } from "./nav-link";
import { ThemeSwitch } from "./theme-toggle";

type Item = { href: string; label: string };

// The current page gets a cue that doesn't rely on colour alone, in the
// section-blue heading colour (over 3:1 on the tint in both themes): an
// underline on desktop, a bar on the inline-start edge in the phone menu.
const DESKTOP_LINK =
  "min-h-11 rounded-full px-3.5 font-semibold text-ink-muted decoration-section-blue-heading decoration-3 underline-offset-6 hover:bg-surface-muted hover:text-ink aria-[current=page]:bg-section-blue aria-[current=page]:text-ink aria-[current=page]:underline";

const MENU_LINK =
  "relative flex min-h-12 w-full rounded-2xl px-4 text-lead font-semibold hover:bg-surface-muted aria-[current=page]:bg-section-blue aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-3 aria-[current=page]:before:start-1.5 aria-[current=page]:before:w-1 aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-section-blue-heading";

/** Desktop navigation (lg and up). */
export function DesktopNavView({
  items,
  label,
  pathname,
}: {
  items: Item[];
  label: string;
  pathname: string | null;
}) {
  return (
    <nav aria-label={label} className="hidden lg:block">
      <ul className="flex items-center gap-1">
        {items.map((item) => (
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

export function DesktopNav(props: { items: Item[]; label: string }) {
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

type MenuLinksProps = {
  items: Item[];
  donateHref: string;
  pathname: string | null;
  close: () => void;
};

function MenuLinksView({ items, pathname, close }: MenuLinksProps) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
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
}: Omit<MenuLinksProps, "items"> & { children: ReactNode }) {
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
  props: Omit<MenuLinksProps, "items" | "pathname"> & { children: ReactNode }
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
  labels,
  donateHref,
}: {
  items: Item[];
  labels: MenuLabels;
  donateHref: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => dialog.current?.close(), []);
  const links = { items, donateHref, close };

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
        className="m-0 ml-auto h-dvh max-h-dvh w-[min(24rem,100vw)] max-w-none overscroll-contain border-s border-border bg-background p-0 text-ink backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-[rgb(23_21_17/0.5)] open:flex open:flex-col"
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          <p id="mobile-menu-title" className="font-display text-h4 font-bold">
            {labels.title}
          </p>
          <button
            type="button"
            {...({ command: "close", commandfor: MENU_ID } as object)}
            onClick={close}
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-semibold hover:bg-surface-muted"
          >
            <X aria-hidden="true" className="size-5" />
            {labels.close}
          </button>
        </div>
        <nav
          aria-label={labels.nav}
          className="flex-1 overflow-y-auto overscroll-contain px-3 py-4"
        >
          <Suspense fallback={<MenuLinksView {...links} pathname={null} />}>
            <MenuLinks {...links} />
          </Suspense>
        </nav>
        <div className="border-t border-border p-5">
          {/* From sm up the header shows its own theme button. */}
          <ThemeSwitch label={labels.theme} className="mb-3 sm:hidden" />
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
