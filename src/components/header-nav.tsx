"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useRef } from "react";

import { buttonStyles } from "@/components/site/button-link";
import { cn } from "@/lib/utils";

import { NavLink } from "./nav-link";

type Item = { href: string; label: string };

const DESKTOP_LINK =
  "min-h-11 rounded-full px-3.5 font-semibold text-ink-muted hover:bg-surface-muted hover:text-ink aria-[current=page]:bg-section-blue aria-[current=page]:text-ink";

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
};

/**
 * Small screens: a native modal <dialog> (focus trap, Escape and inert page
 * for free). Choosing a link closes it, so it never lingers after navigation.
 */
export function MobileMenuView({
  items,
  labels,
  donateHref,
  pathname,
}: {
  items: Item[];
  labels: MenuLabels;
  donateHref: string;
  pathname: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-border-strong px-4 font-semibold text-ink hover:bg-surface-muted lg:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
        {labels.menu}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="mobile-menu-title"
        // Light dismiss (backdrop click) where supported; Escape and the
        // Close button work everywhere.
        {...({ closedby: "any" } as object)}
        className="m-0 ml-auto h-dvh max-h-dvh w-[min(24rem,100vw)] max-w-none bg-background p-0 text-ink backdrop:bg-neutral-950/50 open:flex open:flex-col"
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          <p id="mobile-menu-title" className="font-display text-h4 font-bold">
            {labels.title}
          </p>
          <button
            type="button"
            onClick={close}
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-semibold hover:bg-surface-muted"
          >
            <X aria-hidden="true" className="size-5" />
            {labels.close}
          </button>
        </div>
        <nav
          aria-label={labels.nav}
          className="flex-1 overflow-y-auto px-3 py-4"
        >
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.href}>
                <NavLink
                  href={item.href}
                  pathname={pathname}
                  onNavigate={close}
                  className="flex min-h-12 w-full rounded-2xl px-4 text-lead font-semibold hover:bg-surface-muted aria-[current=page]:bg-section-blue"
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-border p-5">
          <NavLink
            href={donateHref}
            pathname={pathname}
            onNavigate={close}
            className={cn(buttonStyles({ size: "lg" }), "w-full")}
          >
            {labels.donate}
          </NavLink>
        </div>
      </dialog>
    </>
  );
}

export function MobileMenu(props: {
  items: Item[];
  labels: MenuLabels;
  donateHref: string;
}) {
  return <MobileMenuView {...props} pathname={usePathname()} />;
}
